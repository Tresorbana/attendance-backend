import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeopleService } from '../people/people.service';
import { AttendanceService } from '../attendance/attendance.service';
import { FingerprintCache, CachedPerson } from '../shared/fingerprint-cache';
import { AttendanceType } from '../attendance/attendance.entity';

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
      this.configService.get<string>('FINGERPRINT_MATCH_THRESHOLD', '0.82'),
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
    const cached = people
      .filter((p) => p.fingerprintTemplate)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        fingerprintTemplate: p.fingerprintTemplate!,
      }));
    this.fingerprintCache.set(cached);
    return cached;
  }

  /**
   * Normalized Cross-Correlation between two equal-length byte buffers.
   * Returns a value in [-1, 1]; values closer to 1 indicate a match.
   */
  private ncc(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length || a.length === 0) return 0;
    const n = a.length;
    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n;
    const meanB = sumB / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num  += da * db;
      denA += da * da;
      denB += db * db;
    }

    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
  }

  async recognize(templateBase64: string): Promise<RecognizeResult> {
    const people = await this.getEnrolledPeople();

    if (people.length === 0) {
      this.logger.warn('No enrolled employees — recognition skipped');
      return { matched: false };
    }

    let probe: Uint8Array;
    try {
      probe = new Uint8Array(Buffer.from(templateBase64, 'base64'));
    } catch {
      this.logger.error('Invalid probe template');
      return { matched: false };
    }

    let bestMatch: CachedPerson | null = null;
    let bestScore = -Infinity;

    for (const person of people) {
      try {
        const candidate = new Uint8Array(Buffer.from(person.fingerprintTemplate, 'base64'));
        const score = this.ncc(probe, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = person;
        }
      } catch {
        this.logger.warn(`Skipping invalid template for person id=${person.id}`);
      }
    }

    if (!bestMatch || bestScore < this.matchThreshold) {
      this.logger.debug(`No match. best=${bestScore.toFixed(4)} threshold=${this.matchThreshold}`);
      return { matched: false };
    }

    this.logger.debug(`Matched "${bestMatch.name}" ncc=${bestScore.toFixed(4)}`);

    // ── Cooldown check ───────────────────────────────────────────────────────
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

    // ── Check-in or check-out ────────────────────────────────────────────────
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
