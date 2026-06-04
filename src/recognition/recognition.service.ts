import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PeopleService } from '../people/people.service';
import { AttendanceService, AttendanceStage } from '../attendance/attendance.service';
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

/**
 * Optional override for what the next scan should record.
 *   'auto'        — follow the state machine (default UX)
 *   'break-start' — force break start (rejected if not currently checked-in)
 *   'break-end'   — force break end (rejected if not currently on break)
 *   'check-out'   — force check-out (rejected if currently on break)
 */
export type AttendanceMode = 'auto' | 'break-start' | 'break-end' | 'check-out';

const LEGACY_PIXEL_SIZE = 256 * 256;

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
      this.configService.get<string>('FINGERPRINT_MATCH_THRESHOLD', '0.45'),
    );
    const cooldownMinutes = parseInt(
      this.configService.get<string>('CHECKIN_COOLDOWN_MINUTES', '5'),
      10,
    );
    this.cooldownMs = cooldownMinutes * 60 * 1000;
  }

  /** Parse a stored fingerprintTemplate string into one or more MinutiaeTemplates. */
  private parseStoredTemplates(tmpl: string, personId: number, name: string): MinutiaeTemplate[] {
    // Array of templates from multi-scan enrollment: "[{...},{...}]"
    if (tmpl.startsWith('[')) {
      try {
        const arr = JSON.parse(tmpl) as MinutiaeTemplate[];
        return Array.isArray(arr) ? arr : [];
      } catch {
        this.logger.warn(`Person id=${personId} (${name}): corrupt template array JSON`);
        return [];
      }
    }

    // Single minutiae JSON: "{...}"
    if (isMinutiaeTemplate(tmpl)) {
      try {
        return [JSON.parse(tmpl) as MinutiaeTemplate];
      } catch {
        this.logger.warn(`Person id=${personId} (${name}): corrupt minutiae JSON`);
        return [];
      }
    }

    // Legacy pixel-array template (256×256 grayscale base64)
    try {
      const pixBuf = Buffer.from(tmpl, 'base64');
      if (pixBuf.length === LEGACY_PIXEL_SIZE) {
        this.logger.debug(`Person id=${personId}: on-the-fly minutiae extraction from legacy 256×256 template`);
        return [extractMinutiae(new Uint8Array(pixBuf), 256, 256)];
      }
      this.logger.warn(`Person id=${personId} (${name}): unrecognised legacy template size ${pixBuf.length}`);
    } catch (err) {
      this.logger.warn(`Person id=${personId} (${name}): failed to parse legacy template: ${err}`);
    }

    return [];
  }

  private async getEnrolledPeople(): Promise<CachedPerson[]> {
    if (this.fingerprintCache.has()) return this.fingerprintCache.get()!;

    const people = await this.peopleService.findAllWithTemplates();
    const cached: CachedPerson[] = [];

    for (const p of people) {
      if (!p.fingerprintTemplate) continue;

      const parsedMinutiae = this.parseStoredTemplates(p.fingerprintTemplate, p.id, p.name);

      if (parsedMinutiae.length === 0) {
        this.logger.warn(`Person id=${p.id} (${p.name}): skipping — no usable minutiae`);
        continue;
      }

      const counts = parsedMinutiae.map((t) => t.minutiae.length).join('+');
      this.logger.debug(`Enrolled id=${p.id} (${p.name}): ${counts} minutiae across ${parsedMinutiae.length} scan(s)`);
      cached.push({ id: p.id, name: p.name, role: p.role, fingerprintTemplate: p.fingerprintTemplate, parsedMinutiae });
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

    this.logger.debug(`Probe minutiae: ${probe.minutiae.length} (endings=${probe.minutiae.filter(m=>m.type==='ending').length} bifurcations=${probe.minutiae.filter(m=>m.type==='bifurcation').length})`);

    if (probe.minutiae.length < 5) {
      this.logger.warn(`Probe has only ${probe.minutiae.length} minutiae — scan quality too low`);
      return { matched: false };
    }

    let bestMatch: CachedPerson | null = null;
    let bestScore = -Infinity;
    // Stop early when a score is well above threshold — genuine scores are 0.58–0.92,
    // false accepts are 0.02–0.05, so 0.80 is unambiguously correct.
    const EARLY_EXIT_SCORE = 0.80;

    outer: for (const person of people) {
      // Score against each stored scan; take the best (highest similarity wins)
      for (const stored of person.parsedMinutiae) {
        const score = matchMinutiae(probe, stored);
        this.logger.debug(`  vs "${person.name}" (${stored.minutiae.length} min): score=${score.toFixed(4)}`);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = person;
        }
        if (bestScore >= EARLY_EXIT_SCORE) break outer;
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

    // ── Decide next action via state machine ─────────────────────────────────
    const stage = await this.attendanceService.getCurrentStage(bestMatch.id);
    const action: AttendanceType = this.attendanceService.nextAction(stage);
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

  /**
   * Resolve a mode override against the current stage. Returns:
   *   - the action to record, OR
   *   - an error reason string when the override is invalid
   *
   * Examples (rejected requests):
   *   stage='checked-out',  mode='break-start'   → "not_checked_in"
   *   stage='on-break',     mode='check-out'     → "still_on_break"
   *   stage='checked-in',   mode='break-end'     → "not_on_break"
   */
  private resolveAction(
    stage: AttendanceStage,
    mode: AttendanceMode,
  ): { action: AttendanceType } | { error: string } {
    if (mode === 'auto') {
      return { action: this.attendanceService.nextAction(stage) };
    }
    if (mode === 'break-start') {
      if (stage === 'checked-out') return { error: 'not_checked_in' };
      if (stage === 'on-break')    return { error: 'already_on_break' };
      return { action: 'break-start' };
    }
    if (mode === 'break-end') {
      if (stage !== 'on-break') return { error: 'not_on_break' };
      return { action: 'break-end' };
    }
    if (mode === 'check-out') {
      if (stage === 'checked-out') return { error: 'not_checked_in' };
      if (stage === 'on-break')    return { error: 'still_on_break' };
      return { action: 'check-out' };
    }
    return { error: 'unknown_mode' };
  }

  /**
   * Called when the Python pipeline has already identified a person.
   * Skips the TS matching step; performs cooldown check, records attendance,
   * and returns the same RecognizeResult shape as recognize().
   *
   * @param personId  NestJS numeric person ID (from Python result, parsed)
   * @param rawScore  Python confidence score (0–100); stored as 0–1
   */
  async recordAttendanceByPersonId(
    personId: number,
    rawScore: number,
    mode: AttendanceMode = 'auto',
  ): Promise<RecognizeResult | { matched: true; error: string; name: string; score: number; person_id: number }> {
    const score = rawScore / 100; // normalise to 0–1 to match existing records

    const people = await this.getEnrolledPeople();
    const person = people.find((p) => p.id === personId);
    if (!person) {
      this.logger.warn(`Python identified person_id=${personId} but not found in cache`);
      return { matched: false };
    }

    const lastRecord = await this.attendanceService.getLastForPerson(person.id);
    if (lastRecord) {
      const elapsed = Date.now() - new Date(lastRecord.timestamp).getTime();
      if (elapsed < this.cooldownMs) {
        return {
          matched: true,
          name: person.name,
          score,
          person_id: person.id,
          action: lastRecord.type,
          cooldown: true,
        };
      }
    }

    const stage = await this.attendanceService.getCurrentStage(person.id);
    const resolved = this.resolveAction(stage, mode);
    if ('error' in resolved) {
      this.logger.warn(`Mode "${mode}" invalid for person_id=${person.id} (stage=${stage}): ${resolved.error}`);
      return {
        matched: true,
        error: resolved.error,
        name: person.name,
        score,
        person_id: person.id,
      };
    }

    await this.attendanceService.record(person.id, score, resolved.action);

    return {
      matched: true,
      name: person.name,
      score,
      person_id: person.id,
      action: resolved.action,
      cooldown: false,
    };
  }
}
