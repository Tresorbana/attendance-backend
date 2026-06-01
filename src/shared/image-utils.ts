import * as sharp from 'sharp';
import { extractMinutiae } from './fingerprint-minutiae';

const TEMPLATE_W = 256;
const TEMPLATE_H = 256;

// Legacy WBF bridge thumbnail size
const THUMB_W = 96;
const THUMB_H = 96;

const PNG_BASE64_PREFIX = 'iVBO';

/** Returns true if the base64 string encodes a PNG image. */
export function isPngBase64(b64: string): boolean {
  return b64.startsWith(PNG_BASE64_PREFIX);
}

/**
 * Decode a DigitalPersona PNG fingerprint, resize to 256×256 grayscale,
 * apply histogram equalization, extract minutiae, and return a JSON string
 * of MinutiaeTemplate for storage and matching.
 */
export async function processFingerprintPng(pngBase64: string): Promise<string> {
  const buf = Buffer.from(pngBase64, 'base64');
  const { data } = await sharp(buf)
    .grayscale()
    .resize(TEMPLATE_W, TEMPLATE_H, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  histogramEqualize(pixels);

  const template = extractMinutiae(pixels, TEMPLATE_W, TEMPLATE_H);
  return JSON.stringify(template);
}

function histogramEqualize(pixels: Uint8Array): void {
  const n = pixels.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[pixels[i]]++;

  const cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];

  const cdfMin = cdf.find((v) => v > 0) ?? 0;
  const scale  = n - cdfMin || 1;

  for (let i = 0; i < n; i++) {
    pixels[i] = Math.round(((cdf[pixels[i]] - cdfMin) / scale) * 255);
  }
}

/**
 * Convert raw grayscale data from the WBF bridge to a 96×96 base64 template.
 * Kept for backward compatibility — new enrollment uses processFingerprintPng.
 */
export function rawImageToTemplate(srcW: number, srcH: number, gray: Buffer): string {
  if (gray.length < srcW * srcH) {
    throw new Error(`Buffer too small: expected ${srcW * srcH} bytes, got ${gray.length}`);
  }

  const out    = new Uint8Array(THUMB_W * THUMB_H);
  const xRatio = srcW / THUMB_W;
  const yRatio = srcH / THUMB_H;

  for (let dy = 0; dy < THUMB_H; dy++) {
    const sy = dy * yRatio;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = sy - y0;

    for (let dx = 0; dx < THUMB_W; dx++) {
      const sx = dx * xRatio;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = sx - x0;

      out[dy * THUMB_W + dx] = Math.round(
        gray[y0 * srcW + x0] * (1 - fx) * (1 - fy) +
        gray[y0 * srcW + x1] * fx       * (1 - fy) +
        gray[y1 * srcW + x0] * (1 - fx) * fy       +
        gray[y1 * srcW + x1] * fx       * fy,
      );
    }
  }

  histogramEqualize(out);
  return Buffer.from(out).toString('base64');
}
