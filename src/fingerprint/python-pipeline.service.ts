/**
 * PythonPipelineService
 *
 * Thin HTTP client to the Python fingerprint-pipeline FastAPI service
 * (default port 5000). Enabled only when PYTHON_PIPELINE_URL is set in env.
 *
 * Responsibilities:
 *   - Convert raw grayscale scan buffers to PNG so Python can decode them
 *   - POST to /identify and /enroll on the Python service
 *   - Return typed results; never throw — callers fall back to TS matching
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';

export interface PythonIdentifyResult {
  matched: boolean;
  person_id: string | null;
  confidence_score: number;
  flag: 'confirmed' | 'low_confidence' | 'no_match' | 'poor_scan_quality';
  error?: string;
}

export interface PythonEnrollResult {
  success: boolean;
  person_id: string;
  quality_scores: Record<string, unknown>[];
  steps_applied: string[];
  template_stored: boolean;
  error?: string;
}

export interface PythonQualityResult {
  acceptable: boolean;
  clarity_score: number;
  coverage: number;
  reason: string;
  error?: string;
}

export interface PythonCoverageHint {
  direction: 'top-left' | 'top' | 'top-right'
           | 'left'     | 'center' | 'right'
           | 'bottom-left' | 'bottom' | 'bottom-right';
  message: string;
}

export interface PythonCoverageState {
  grid_size: number;
  cells: number[][];           // G×G grid of minutiae counts
  covered_cells: number;
  total_cells: number;
  coverage_ratio: number;      // 0–1
  total_minutiae: number;
  scans_accepted: number;
  scans_attempted: number;
  target_coverage: number;
  target_minutiae: number;
  complete: boolean;
  ceiling_hit: boolean;
  should_continue: boolean;
  stalled: boolean;
  hint: PythonCoverageHint | null;
  hint_direction: string | null;
}

export interface PythonCoverageResult {
  accepted: boolean;
  reason: string;
  clarity_score: number;
  coverage: number;
  minutiae_count: number;
  new_cells_covered: number;
  state: PythonCoverageState;
  error?: string;
}

@Injectable()
export class PythonPipelineService {
  private readonly logger = new Logger(PythonPipelineService.name);
  private readonly baseUrl: string | null;

  constructor(private readonly config: ConfigService) {
    const url = config.get<string>('PYTHON_PIPELINE_URL', '').trim();
    this.baseUrl = url || null;
    if (this.baseUrl) {
      this.logger.log(`Python fingerprint pipeline → ${this.baseUrl}`);
    } else {
      this.logger.error(
        'PYTHON_PIPELINE_URL is not set. ' +
        'The Python fingerprint pipeline is required for all matching and enrollment. ' +
        'Start fingerprint-pipeline/app.py and set PYTHON_PIPELINE_URL=http://localhost:5000',
      );
    }
  }

  isEnabled(): boolean {
    return this.baseUrl !== null;
  }

  /** Convert raw uncompressed grayscale scan to base64 PNG for Python. */
  async rawGrayToPng(width: number, height: number, data: Buffer): Promise<string> {
    const png = await sharp(data, {
      raw: { width, height, channels: 1 },
    })
      .png()
      .toBuffer();
    return png.toString('base64');
  }

  /**
   * Identify a fingerprint by sending a PNG (base64) to Python /identify.
   * Returns null if the service is disabled or unreachable.
   */
  async identify(pngBase64: string): Promise<PythonIdentifyResult | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await fetch(`${this.baseUrl}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pngBase64 }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        this.logger.warn(`Python /identify returned HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as PythonIdentifyResult;
    } catch (err) {
      this.logger.warn(`Python /identify unreachable: ${err}`);
      return null;
    }
  }

  /**
   * Enroll a person in the Python pipeline.
   * personId must be the NestJS numeric person ID converted to string.
   * images is an array of base64 PNG strings (ideally 5, minimum 2).
   */
  async enroll(
    personId: string,
    images: string[],
  ): Promise<PythonEnrollResult | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await fetch(`${this.baseUrl}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: personId, images }),
        // 3 min: adaptive enrollment can submit 8–12 scans which compound the
        // ICP/TPS/mosaic work; 120s was too tight for the upper end.
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        this.logger.warn(`Python /enroll returned HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as PythonEnrollResult;
    } catch (err) {
      this.logger.warn(`Python /enroll unreachable: ${err}`);
      return null;
    }
  }

  /**
   * Decode a compressed fingerprint image (PNG/JPEG2000 from intermediate capture)
   * to base64 PNG using sharp. Returns null when the format is not supported (e.g. WSQ).
   */
  async compressedImageToPng(data: Buffer): Promise<string | null> {
    try {
      const png = await sharp(data).png().toBuffer();
      return png.toString('base64');
    } catch {
      return null;
    }
  }

  /** Delete all fingerprint templates for a person (call when deleting from NestJS). */
  async deletePerson(personId: string): Promise<void> {
    if (!this.baseUrl) return;
    try {
      await fetch(`${this.baseUrl}/person/${encodeURIComponent(personId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.warn(`Python /person/${personId} delete failed: ${err}`);
    }
  }

  /**
   * Submit one enrollment scan against a coverage session.
   * Returns updated coverage state (per-cell grid + completion flags).
   */
  async coverage(
    sessionId: string,
    pngBase64: string,
  ): Promise<PythonCoverageResult | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await fetch(`${this.baseUrl}/coverage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, image: pngBase64 }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        this.logger.warn(`Python /coverage returned HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as PythonCoverageResult;
    } catch (err) {
      this.logger.warn(`Python /coverage unreachable: ${err}`);
      return null;
    }
  }

  /** Reset coverage session (called on cancel). */
  async resetCoverage(sessionId: string): Promise<void> {
    if (!this.baseUrl) return;
    try {
      await fetch(`${this.baseUrl}/coverage/${encodeURIComponent(sessionId)}/reset`, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
      });
    } catch {}
  }

  /** Quick quality check on a raw scan before enrollment. */
  async scanQuality(pngBase64: string): Promise<PythonQualityResult | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await fetch(`${this.baseUrl}/scan-quality`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: pngBase64 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      return (await res.json()) as PythonQualityResult;
    } catch {
      return null;
    }
  }
}
