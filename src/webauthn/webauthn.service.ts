import { Injectable, Logger, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { randomUUID } from 'crypto';
import { WebAuthnCredential } from './webauthn-credential.entity';
import { PeopleService } from '../people/people.service';
import { AttendanceService } from '../attendance/attendance.service';

export interface AttendanceResult {
  matched: true;
  personId: number;
  name: string;
  action: 'check-in' | 'check-out';
  cooldown: boolean;
  score: number;
}

interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

@Injectable()
export class WebAuthnService {
  private readonly logger = new Logger(WebAuthnService.name);
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly origin: string;
  private readonly cooldownMs: number;

  // In-memory challenge store (keyed by opaque state UUID, TTL = 5 min)
  private readonly challenges = new Map<string, ChallengeEntry>();

  constructor(
    @InjectRepository(WebAuthnCredential)
    private readonly credRepo: Repository<WebAuthnCredential>,
    private readonly peopleService: PeopleService,
    private readonly attendanceService: AttendanceService,
    private readonly config: ConfigService,
  ) {
    this.rpID   = config.get('WEBAUTHN_RP_ID',   'localhost');
    this.rpName = config.get('WEBAUTHN_RP_NAME',  'SAMS Attendance');
    this.origin = config.get('WEBAUTHN_ORIGIN',   'http://localhost:3000');
    this.cooldownMs = parseInt(config.get('CHECKIN_COOLDOWN_MINUTES', '5'), 10) * 60_000;
  }

  // ── Registration ────────────────────────────────────────────────────────────

  async getRegistrationOptions(personId: number): Promise<{
    options: PublicKeyCredentialCreationOptionsJSON;
    state: string;
  }> {
    const people = await this.peopleService.findAll();
    const person = people.find((p) => p.id === personId);
    if (!person) throw new NotFoundException(`Person ${personId} not found`);

    const existingCreds = await this.credRepo.find({ where: { personId } });

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: person.name,
      userID: new TextEncoder().encode(String(personId)),
      userDisplayName: person.name,
      attestationType: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',  // use built-in Windows Hello
        userVerification: 'required',
        residentKey: 'preferred',
      },
      excludeCredentials: existingCreds.map((c) => ({
        id: c.credentialId,
      })),
      timeout: 120_000,
    });

    const state = randomUUID();
    this.storeChallenge(state, options.challenge);
    return { options, state };
  }

  async verifyRegistration(
    state: string,
    personId: number,
    response: RegistrationResponseJSON,
  ): Promise<{ credentialId: string; personName: string }> {
    const challenge = this.consumeChallenge(state);

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException('WebAuthn registration verification failed');
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // Remove any existing credentials for this person (re-enrollment)
    await this.credRepo.delete({ personId });

    const cred = this.credRepo.create({
      credentialId: credential.id,
      personId,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      credentialDeviceType: credentialDeviceType ?? null,
      credentialBackedUp: credentialBackedUp ?? false,
      transports: credential.transports ? JSON.stringify(credential.transports) : null,
    });
    await this.credRepo.save(cred);
    this.logger.log(`Registered WebAuthn credential for personId=${personId} (${credential.id.slice(0, 12)}…)`);

    const people = await this.peopleService.findAll();
    const person = people.find((p) => p.id === personId);
    return { credentialId: credential.id, personName: person?.name ?? String(personId) };
  }

  // ── Authentication (Attendance) ─────────────────────────────────────────────

  async getAuthenticationOptions(): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    state: string;
  }> {
    const allCreds = await this.credRepo.find();

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      allowCredentials: allCreds.map((c) => ({
        id: c.credentialId,
        transports: c.transports
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (JSON.parse(c.transports) as any[])
          : undefined,
      })),
      timeout: 120_000,
    });

    const state = randomUUID();
    this.storeChallenge(state, options.challenge);
    return { options, state };
  }

  async verifyAuthentication(
    state: string,
    response: AuthenticationResponseJSON,
  ): Promise<AttendanceResult> {
    const challenge = this.consumeChallenge(state);

    // Identify which credential was used
    const credentialId = response.id;
    const stored = await this.credRepo.findOne({ where: { credentialId } });
    if (!stored) {
      throw new NotFoundException(`No enrolled credential matches this fingerprint`);
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpID,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
        counter: Number(stored.counter),
        transports: stored.transports
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (JSON.parse(stored.transports) as any[])
          : undefined,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      throw new UnauthorizedException('WebAuthn authentication verification failed');
    }

    // Update counter (replay-attack protection)
    stored.counter = verification.authenticationInfo.newCounter;
    await this.credRepo.save(stored);

    // ── Cooldown check ───────────────────────────────────────────────────────
    const lastRecord = await this.attendanceService.getLastForPerson(stored.personId);
    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
      if (elapsed < this.cooldownMs) {
        const people = await this.peopleService.findAll();
        const person = people.find((p) => p.id === stored.personId);
        return {
          matched: true,
          personId: stored.personId,
          name: person?.name ?? String(stored.personId),
          action: lastRecord.type as 'check-in' | 'check-out',
          cooldown: true,
          score: 1,
        };
      }
    }

    // ── Record attendance ────────────────────────────────────────────────────
    const openCheckIn = await this.attendanceService.getOpenCheckInToday(stored.personId);
    const action = openCheckIn ? 'check-out' : 'check-in';
    await this.attendanceService.record(stored.personId, 1, action as any);

    const people = await this.peopleService.findAll();
    const person = people.find((p) => p.id === stored.personId);
    this.logger.log(`Attendance recorded: ${person?.name} → ${action}`);

    return {
      matched: true,
      personId: stored.personId,
      name: person?.name ?? String(stored.personId),
      action: action as 'check-in' | 'check-out',
      cooldown: false,
      score: 1,
    };
  }

  // ── Credential management ───────────────────────────────────────────────────

  async getCredentialsForPerson(personId: number): Promise<{ count: number; createdAt: Date | null }> {
    const creds = await this.credRepo.find({ where: { personId } });
    return {
      count: creds.length,
      createdAt: creds[0]?.createdAt ?? null,
    };
  }

  async deleteCredentialsForPerson(personId: number): Promise<void> {
    await this.credRepo.delete({ personId });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private storeChallenge(state: string, challenge: string) {
    // Prune expired entries first
    const now = Date.now();
    for (const [k, v] of this.challenges) if (v.expiresAt < now) this.challenges.delete(k);
    this.challenges.set(state, { challenge, expiresAt: now + 5 * 60_000 });
  }

  private consumeChallenge(state: string): string {
    const entry = this.challenges.get(state);
    if (!entry) throw new BadRequestException('Invalid or expired WebAuthn state');
    if (entry.expiresAt < Date.now()) {
      this.challenges.delete(state);
      throw new BadRequestException('WebAuthn challenge expired — try again');
    }
    this.challenges.delete(state);
    return entry.challenge;
  }
}
