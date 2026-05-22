import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeopleService } from '../people/people.service';
import { AttendanceService } from '../attendance/attendance.service';
import { Person } from '../people/people.entity';

export type RecognizeResult =
  | { matched: true; name: string; confidence: number; person_id: number }
  | { matched: false };

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);
  private readonly baseThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    private readonly peopleService: PeopleService,
    private readonly attendanceService: AttendanceService,
    private readonly configService: ConfigService,
  ) {
    this.baseThreshold = parseFloat(
      this.configService.get<string>('RECOGNITION_THRESHOLD', '0.6'),
    );
    const cooldownMinutes = parseInt(
      this.configService.get<string>('CHECKIN_COOLDOWN_MINUTES', '5'),
      10,
    );
    this.cooldownMs = cooldownMinutes * 60 * 1000;
  }

  /**
   * Adaptive threshold based on lighting conditions reported by the browser.
   *
   * The frontend preprocesses dark frames (gamma + contrast stretch) before
   * running face-api.js. But preprocessing introduces minor descriptor drift,
   * so we relax the threshold slightly in poor light to compensate.
   *
   *   brightness  >= 60  → standard threshold (0.60)
   *   brightness  30–60  → +8%  (low light, preprocessed)
   *   brightness  12–30  → +15% (very dark, heavy preprocessing)
   *   brightness unknown → standard (no brightness reported)
   */
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

  /**
   * Match a face descriptor against all enrolled employees.
   *
   * How attendance is recorded:
   *   1. Load all enrolled face descriptors from PostgreSQL.
   *   2. Compute Euclidean distance to each; find the closest.
   *   3. If closest distance < threshold → matched.
   *   4. Adaptive threshold: slightly relaxed in low / very-low light so
   *      preprocessed descriptors are not unfairly penalised.
   *   5. Cooldown check: if the person clocked in within the cooldown window
   *      (default 5 min), return matched=true but skip the DB insert to
   *      prevent duplicate records.
   *   6. Otherwise insert a new row in the `attendance` table with the
   *      person_id, confidence score, and current timestamp.
   */
  async recognize(descriptor: number[], brightness?: number): Promise<RecognizeResult> {
    const people = await this.peopleService.findAllWithDescriptors();

    if (people.length === 0) {
      this.logger.warn('No enrolled employees — recognition skipped');
      return { matched: false };
    }

    let bestMatch: Person | null = null;
    let bestDistance = Infinity;

    for (const person of people) {
      if (!person.faceDescriptor || person.faceDescriptor.length < 128) continue;
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

    // Normalise confidence to 0–1 against the base threshold so it reflects
    // actual quality rather than how permissive the current threshold is.
    const confidence = Math.max(0, 1 - bestDistance / this.baseThreshold);

    this.logger.debug(
      `Matched "${bestMatch.name}" dist=${bestDistance.toFixed(4)} conf=${(confidence * 100).toFixed(1)}% brightness=${brightness ?? 'n/a'}`,
    );

    // ── Cooldown check ───────────────────────────────────────────────────────
    const lastRecord = await this.attendanceService.getLastForPerson(bestMatch.id);
    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
      if (elapsed < this.cooldownMs) {
        this.logger.debug(
          `Cooldown active for "${bestMatch.name}" — ${Math.round((this.cooldownMs - elapsed) / 1000)}s remaining`,
        );
        return { matched: true, name: bestMatch.name, confidence, person_id: bestMatch.id };
      }
    }

    // ── Record attendance ────────────────────────────────────────────────────
    await this.attendanceService.record(bestMatch.id, confidence);

    return { matched: true, name: bestMatch.name, confidence, person_id: bestMatch.id };
  }
}
