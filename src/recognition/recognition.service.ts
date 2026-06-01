import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeopleService } from '../people/people.service';
import { AttendanceService } from '../attendance/attendance.service';
import { FingerprintCache, CachedPerson } from '../shared/fingerprint-cache';
import { AttendanceType } from '../attendance/attendance.entity';
import { isPngBase64, processFingerprintPng } from '../shared/image-utils';
import {
  MinutiaeTemplate,
  extractMinutiae,
  matchMinutiae,
  isMinutiaeTemplate,
} from '../shared/fingerprint-minutiae';

export type RecognizeResult =
  | {
      matched: true;
      name: string;
      score: number;
      person_id: number;
      action: AttendanceType;
      cooldown: boolean;
    }
  | { matched: false };

const LEGACY_PIXEL_SIZE = 256 * 256; // old 256×256 grayscale byte array

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);
  private readonly matchThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly peopleService: PeopleService,
    private readonly attendanceService: AttendanceService,
    private readonly configService: ConfigService,
    private readonly fingerprintCache: FingerprintCache,
  ) {
    this.matchThreshold = parseFloat(
      this.configService.get<string>('FINGERPRINT_MATCH_THRESHOLD', '0.30'),
    );
    const cooldownMinutes = parseInt(
      this.configService.get<string>('CHECKIN_COOLDOWN_MINUTES', '5'),
      10,
    );
    this.cooldownMs = cooldownMinutes * 60 * 1000;
  }

  private async getEnrolledPeople(): Promise<CachedPerson[]> {
    if (this.fingerprintCache.has()) return this.fingerprintCache.get()!;

    const people = await this.peopleService.findAllWithTemplates();
    const cached: CachedPerson[] = [];

    for (const p of people) {
      if (!p.fingerprintTemplate) continue;

      const tmpl = p.fingerprintTemplate;
      let parsedMinutiae: MinutiaeTemplate | undefined;

      if (isMinutiaeTemplate(tmpl)) {
        try {
          parsedMinutiae = JSON.parse(tmpl) as MinutiaeTemplate;
        } catch {
          this.logger.warn(`Person id=${p.id} (${p.name}): corrupt minutiae JSON`);
        }
      } else {
        // Old pixel-array template (96×96 or 256×256 base64) — extract minutiae on the fly.
        try {
          const pixBuf = Buffer.from(tmpl, 'base64');
          if (pixBuf.length === LEGACY_PIXEL_SIZE) {
            parsedMinutiae = extractMinutiae(new Uint8Array(pixBuf), 256, 256);
            this.logger.debug(`Person id=${p.id}: extracted minutiae from legacy 256×256 template`);
          } else {
            this.logger.warn(`Person id=${p.id} (${p.name}): unrecognised legacy template size ${pixBuf.length}`);
          }
        } catch (err) {
          this.logger.warn(`Person id=${p.id} (${p.name}): failed to extract minutiae from legacy template: ${err}`);
        }
      }

      if (!parsedMinutiae) {
        this.logger.warn(`Person id=${p.id} (${p.name}): skipping — no usable minutiae`);
      }

      cached.push({ id: p.id, name: p.name, role: p.role, fingerprintTemplate: tmpl, parsedMinutiae });
    }

    this.fingerprintCache.set(cached);
    return cached;
  }

  /** Convert any probe format (PNG, minutiae JSON, legacy pixels) to a MinutiaeTemplate. */
  private async probeToMinutiae(templateBase64: string): Promise<MinutiaeTemplate | null> {
    if (isPngBase64(templateBase64)) {
      try {
        const json = await processFingerprintPng(templateBase64);
        return JSON.parse(json) as MinutiaeTemplate;
      } catch (err) {
        this.logger.error(`Failed to process PNG probe: ${err}`);
        return null;
      }
    }

    if (isMinutiaeTemplate(templateBase64)) {
      try {
        return JSON.parse(templateBase64) as MinutiaeTemplate;
      } catch {
        this.logger.error('Invalid minutiae JSON probe');
        return null;
      }
    }

    // Legacy pixel template
    try {
      const pixBuf = Buffer.from(templateBase64, 'base64');
      if (pixBuf.length === LEGACY_PIXEL_SIZE) {
        return extractMinutiae(new Uint8Array(pixBuf), 256, 256);
      }
    } catch {}

    this.logger.error('Probe template format unrecognised');
    return null;
  }

  async recognize(templateBase64: string): Promise<RecognizeResult> {
    const people = await this.getEnrolledPeople();

    if (people.length === 0) {
      this.logger.warn('No enrolled employees — recognition skipped');
      return { matched: false };
    }

    const probe = await this.probeToMinutiae(templateBase64);
    if (!probe) return { matched: false };

    if (probe.minutiae.length < 5) {
      this.logger.warn(`Probe has only ${probe.minutiae.length} minutiae — scan quality too low`);
      return { matched: false };
    }

    let bestMatch: CachedPerson | null = null;
    let bestScore = -Infinity;

    for (const person of people) {
      if (!person.parsedMinutiae) continue;
      const score = matchMinutiae(probe, person.parsedMinutiae);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = person;
      }
    }

    if (!bestMatch || bestScore < this.matchThreshold) {
      this.logger.debug(`No match. best=${bestScore.toFixed(4)} threshold=${this.matchThreshold}`);
      return { matched: false };
    }

    this.logger.debug(`Matched "${bestMatch.name}" minutiae-score=${bestScore.toFixed(4)}`);

    // ── Cooldown check ────────────────────────────────────────────────────────
    const lastRecord = await this.attendanceService.getLastForPerson(bestMatch.id);
    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
      if (elapsed < this.cooldownMs) {
        return {
          matched: true,
          name: bestMatch.name,
          score: bestScore,
          person_id: bestMatch.id,
          action: lastRecord.type,
          cooldown: true,
        };
      }
    }

    // ── Check-in or check-out ─────────────────────────────────────────────────
    const openCheckIn = await this.attendanceService.getOpenCheckInToday(bestMatch.id);
    const action: AttendanceType = openCheckIn ? 'check-out' : 'check-in';
    await this.attendanceService.record(bestMatch.id, bestScore, action);

    return {
      matched: true,
      name: bestMatch.name,
      score: bestScore,
      person_id: bestMatch.id,
      action,
      cooldown: false,
    };
  }
}
