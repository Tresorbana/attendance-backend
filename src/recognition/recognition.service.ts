import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeopleService } from '../people/people.service';
import { AttendanceService } from '../attendance/attendance.service';
import { DescriptorCache, CachedPerson } from '../shared/descriptor-cache';
import { AttendanceType } from '../attendance/attendance.entity';

export type RecognizeResult =
  | {
      matched: true;
      name: string;
      confidence: number;
      person_id: number;
      action: AttendanceType;
      /** true if within cooldown — record was NOT written */
      cooldown: boolean;
    }
  | { matched: false };

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);
  private readonly baseThreshold: number;
  private readonly minConfidence: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly peopleService: PeopleService,
    private readonly attendanceService: AttendanceService,
    private readonly configService: ConfigService,
    private readonly descriptorCache: DescriptorCache,
  ) {
    this.baseThreshold = parseFloat(
      this.configService.get<string>('RECOGNITION_THRESHOLD', '0.6'),
    );
    this.minConfidence = parseFloat(
      this.configService.get<string>('MIN_RECOGNITION_CONFIDENCE', '0.5'),
    );
    const cooldownMinutes = parseInt(
      this.configService.get<string>('CHECKIN_COOLDOWN_MINUTES', '5'),
      10,
    );
    this.cooldownMs = cooldownMinutes * 60 * 1000;
  }

  private effectiveThreshold(brightness?: number): number {
    if (brightness === undefined || brightness === null) return this.baseThreshold;
    if (brightness < 30) return this.baseThreshold * 1.15;
    if (brightness < 60) return this.baseThreshold * 1.08;
    return this.baseThreshold;
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  }

  private async getPeople(): Promise<CachedPerson[]> {
    if (this.descriptorCache.has()) {
      return this.descriptorCache.get()!;
    }
    const people = await this.peopleService.findAllWithDescriptors();
    const cached = people
      .filter((p) => p.faceDescriptor && p.faceDescriptor.length >= 128)
      .map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        faceDescriptor: p.faceDescriptor,
      }));
    this.descriptorCache.set(cached);
    return cached;
  }

  /**
   * Recognize a face and record check-in or check-out automatically.
   *
   * Logic:
   *   - If the person has an open check-in today (no check-out yet) → record check-out
   *   - Otherwise → record check-in
   *   - Cooldown applies to both actions to prevent duplicate scans
   */
  async recognize(descriptor: number[], brightness?: number): Promise<RecognizeResult> {
    const people = await this.getPeople();

    if (people.length === 0) {
      this.logger.warn('No enrolled employees — recognition skipped');
      return { matched: false };
    }

    let bestMatch: CachedPerson | null = null;
    let bestDistance = Infinity;

    for (const person of people) {
      const dist = this.euclideanDistance(descriptor, person.faceDescriptor);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = person;
      }
    }

    const threshold = this.effectiveThreshold(brightness);

    if (!bestMatch || bestDistance >= threshold) {
      this.logger.debug(
        `No match. dist=${bestDistance.toFixed(4)} threshold=${threshold.toFixed(4)} brightness=${brightness ?? 'n/a'}`,
      );
      return { matched: false };
    }

    const confidence = Math.max(0, 1 - bestDistance / this.baseThreshold);

    if (confidence < this.minConfidence) {
      this.logger.debug(
        `Rejected low-confidence match "${bestMatch.name}" conf=${(confidence * 100).toFixed(1)}%`,
      );
      return { matched: false };
    }

    this.logger.debug(
      `Matched "${bestMatch.name}" dist=${bestDistance.toFixed(4)} conf=${(confidence * 100).toFixed(1)}%`,
    );

    // ── Cooldown check ───────────────────────────────────────────────────────
    const lastRecord = await this.attendanceService.getLastForPerson(bestMatch.id);
    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
      if (elapsed < this.cooldownMs) {
        this.logger.debug(
          `Cooldown active for "${bestMatch.name}" — ${Math.round((this.cooldownMs - elapsed) / 1000)}s remaining`,
        );
        return {
          matched: true,
          name: bestMatch.name,
          confidence,
          person_id: bestMatch.id,
          action: lastRecord.type,
          cooldown: true,
        };
      }
    }

    // ── Determine action: check-in or check-out ──────────────────────────────
    const openCheckIn = await this.attendanceService.getOpenCheckInToday(bestMatch.id);
    const action: AttendanceType = openCheckIn ? 'check-out' : 'check-in';

    await this.attendanceService.record(bestMatch.id, confidence, action);

    return {
      matched: true,
      name: bestMatch.name,
      confidence,
      person_id: bestMatch.id,
      action,
      cooldown: false,
    };
  }
}
