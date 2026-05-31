/**
 * Fingerprint scanner service using Windows Biometric Framework (WBF).
 * Works with the default DigitalPersona driver for the U.are.U 4500 —
 * no driver replacement (Zadig) required.
 *
 * WBF ships with Windows 7+ and is accessible via winbio.dll.
 * The captured BIR (Biometric Information Record) is in ANSI/INCITS 381
 * format, which contains the raw grayscale fingerprint image.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import * as koffi from 'koffi';

// WBF constants
const WINBIO_TYPE_FINGERPRINT         = 0x00000008;
const WINBIO_POOL_SYSTEM              = 0x00000001;
const WINBIO_PURPOSE_ENROLL           = 0x01;
const WINBIO_SUBTYPE_ANY              = 0xFF;
const WINBIO_E_BAD_CAPTURE            = 0x80098002; // poor quality — retry
const WINBIO_E_CANCELED               = 0x80098001;

// WINBIO_BIR memory layout (WINBIO_BIR_DATA = {Size:uint32, Offset:uint32} = 8 bytes)
//   offset  0: HeaderBlock.Size
//   offset  4: HeaderBlock.Offset
//   offset  8: StandardDataBlock.Size
//   offset 12: StandardDataBlock.Offset  ← we need this
//   offset 16: SignatureBlock.Size
//   offset 20: SignatureBlock.Offset
const BIR_STD_OFFSET_POS = 12;

// WINBIO_BDB_ANSI_381_HEADER offsets (pack(1), total 40 bytes)
//   0: RecordLength (uint64)
//   8: FormatIdentifier (uint32)
//  12: VersionNumber (uint32)
//  16: ProductIdentifier.Owner (uint16)
//  18: ProductIdentifier.Type (uint16)
//  20: CaptureDeviceId (uint16)
//  22: ScanningLevel (uint16)
//  24: ImageAcquisitionLevel (uint16)
//  26: NumberFingers (uint16)
//  28: RotationUncertainty (uint16)
//  30: PixelDPI (uint16, pixels/cm — multiply ×2.54 for dpi)
//  32: SizeX (uint16) ← image width
//  34: SizeY (uint16) ← image height
//  36: Quality (uint16)
//  38: NumberFingerViews (uint16)
const ANSI_381_HDR_SIZE = 40;
const ANSI_381_HDR_WIDTH_OFFSET  = 32;
const ANSI_381_HDR_HEIGHT_OFFSET = 34;

// WINBIO_BDB_ANSI_381_RECORD offsets (pack(1), total 14 bytes)
//   0: Length (uint32)
//   4: FingerPosition (uint8)
//   5: CountOfViews (uint8)
//   6: ViewNumber (uint8)
//   7: ImageQuality (uint8)
//   8: ImpressionType (uint8)
//   9: HorzLineLength (uint16) ← pixel width
//  11: VertLineLength (uint16) ← pixel height
//  13: Reserved (uint8)
// Pixel bytes follow immediately (HorzLineLength × VertLineLength)
const ANSI_381_REC_SIZE        = 14;
const ANSI_381_REC_HORZ_OFFSET = 9;
const ANSI_381_REC_VERT_OFFSET = 11;

// Down-sample dimensions for compact DB storage
const THUMB_W = 96;
const THUMB_H = 96;

export type ScannerStatus = 'disconnected' | 'ready' | 'scanning' | 'error';
export interface ScanEvent { templateBase64: string; }

@Injectable()
export class FingerprintScannerService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FingerprintScannerService.name);

  private lib: ReturnType<typeof koffi.load> | null = null;
  private sessionHandle: number | null = null;
  private status: ScannerStatus = 'disconnected';
  private running = false;

  // Lazily declared koffi function handles
  private fnCapture: ((...args: unknown[]) => Promise<number>) | null = null;
  private fnFree: ((...args: unknown[]) => number) | null = null;

  async onModuleInit() {
    this.initLibrary();
    if (this.lib) {
      await this.openSession();
      if (this.sessionHandle) {
        this.setStatus('ready');
        void this.captureLoop();
      }
    }
  }

  async onModuleDestroy() {
    this.running = false;
    await this.closeSession();
  }

  getStatus(): ScannerStatus { return this.status; }

  // ── Private ──────────────────────────────────────────────────────────────

  private initLibrary() {
    try {
      this.lib = koffi.load('winbio.dll');
      this.logger.log('winbio.dll loaded (Windows Biometric Framework)');
    } catch (err: unknown) {
      this.logger.error(
        'Cannot load winbio.dll. Fingerprint scanning unavailable. ' +
        (err instanceof Error ? err.message : String(err)),
      );
      this.setStatus('error');
    }
  }

  private async openSession() {
    if (!this.lib) return;
    try {
      // Declare last param as void * (not void **) and pass a Buffer.
      // koffi's void**+array syntax returns null for small integer handles (e.g. 1);
      // the Buffer approach correctly captures the 8-byte pointer value.
      const fn = this.lib.func(
        'int __stdcall WinBioOpenSession(' +
        'uint factor, uint poolType, uint sessionFlags, ' +
        'void *unitArray, size_t unitCount, void *databaseId, void *sessionHandleOut)',
      );
      const handleBuf = Buffer.alloc(8, 0);
      const hr: number = fn(
        WINBIO_TYPE_FINGERPRINT, WINBIO_POOL_SYSTEM, 0,
        null, 0, null, handleBuf,
      );
      if (hr === 0) {
        this.sessionHandle = Number(handleBuf.readBigUInt64LE(0));
        const unitCount = this.countBiometricUnits();
        if (unitCount === 0) {
          this.logger.error(
            'WBF session opened but no fingerprint readers detected. ' +
            'Plug in the U.are.U 4500 and install the DigitalPersona driver.',
          );
          await this.closeSession();
          this.setStatus('error');
          return;
        }
        this.logger.log(`Windows Biometric Framework session opened — ${unitCount} unit(s) ready`);
      } else {
        this.logger.error(
          `WinBioOpenSession failed 0x${(hr >>> 0).toString(16)}. ` +
          'Is the U.are.U 4500 plugged in and driver installed?',
        );
        this.setStatus('error');
      }
    } catch (err: unknown) {
      this.logger.error('WBF session error: ' + (err instanceof Error ? err.message : String(err)));
      this.setStatus('error');
    }
  }

  private async closeSession() {
    if (!this.lib || !this.sessionHandle) return;
    try {
      const fn = this.lib.func('int __stdcall WinBioCloseSession(uint64 session)');
      fn(this.sessionHandle);
      this.sessionHandle = null;
    } catch {}
  }

  private countBiometricUnits(): number {
    if (!this.lib) return 0;
    try {
      const fn = this.lib.func(
        'int __stdcall WinBioEnumBiometricUnits(uint factor, void **unitSchemaArray, size_t *unitCount)',
      );
      const arr: unknown[] = [null];
      const cnt: unknown[] = [0];
      const hr: number = fn(WINBIO_TYPE_FINGERPRINT, arr, cnt);
      return hr === 0 ? (cnt[0] as number) : 0;
    } catch {
      return 0;
    }
  }

  private async captureLoop() {
    if (!this.lib || !this.sessionHandle) return;
    this.running = true;

    // Declare functions once and reuse
    const captureSync = this.lib.func(
      'int __stdcall WinBioCaptureSample(' +
      'uint64 session, uint8_t purpose, uint8_t subFactor, ' +
      'uint32_t *unitId, void **sample, size_t *sampleSize, int32_t *rejectDetail)',
    );
    this.fnCapture = promisify(captureSync.async.bind(captureSync)) as typeof this.fnCapture;
    this.fnFree = this.lib.func('int __stdcall WinBioFree(void *address)') as typeof this.fnFree;

    while (this.running) {
      try {
        const unitId: unknown[]      = [0];
        const samplePtr: unknown[]   = [null];
        const sampleSize: unknown[]  = [0];
        const rejectDetail: unknown[] = [0];

        const hr: number = await this.fnCapture!(
          this.sessionHandle,
          WINBIO_PURPOSE_ENROLL,
          WINBIO_SUBTYPE_ANY,
          unitId, samplePtr, sampleSize, rejectDetail,
        );

        if (!this.running) break;

        const hrU = hr >>> 0;

        if (hr === 0) {
          const ptr = samplePtr[0];
          const size = sampleSize[0] as number;
          this.setStatus('scanning');
          try {
            const raw = koffi.decode(ptr, 'uint8', size) as Uint8Array;
            this.processBIR(Buffer.from(raw));
          } finally {
            this.fnFree!(ptr);
          }
        } else if (hrU === WINBIO_E_BAD_CAPTURE) {
          this.logger.debug('Low quality capture — retry');
        } else if (hrU === WINBIO_E_CANCELED) {
          break;
        } else {
          this.logger.warn(`WinBioCaptureSample 0x${hrU.toString(16)}`);
          await new Promise((r) => setTimeout(r, 1000));
        }

        if (this.running) this.setStatus('ready');
      } catch (err: unknown) {
        if (!this.running) break;
        this.logger.error('Capture error: ' + (err instanceof Error ? err.message : String(err)));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    this.setStatus('disconnected');
  }

  /**
   * Parse a WINBIO_BIR buffer (ANSI 381 format) to extract raw pixel bytes,
   * normalize contrast, and downsample for compact storage.
   */
  private processBIR(bir: Buffer) {
    try {
      // Locate StandardDataBlock within the BIR
      const stdOffset = bir.readUInt32LE(BIR_STD_OFFSET_POS);

      // Read image dimensions from ANSI 381 header
      const hdrBase = stdOffset;
      let w = bir.readUInt16LE(hdrBase + ANSI_381_HDR_WIDTH_OFFSET);
      let h = bir.readUInt16LE(hdrBase + ANSI_381_HDR_HEIGHT_OFFSET);

      // Read actual scan dimensions from first finger record
      const recBase = hdrBase + ANSI_381_HDR_SIZE;
      const recW = bir.readUInt16LE(recBase + ANSI_381_REC_HORZ_OFFSET);
      const recH = bir.readUInt16LE(recBase + ANSI_381_REC_VERT_OFFSET);
      if (recW > 0) w = recW;
      if (recH > 0) h = recH;

      if (w === 0 || h === 0) {
        this.logger.warn('BIR returned zero-dimension image');
        return;
      }

      const pixelStart = recBase + ANSI_381_REC_SIZE;
      const pixels = new Uint8Array(bir.buffer, bir.byteOffset + pixelStart, w * h);

      const equalized  = this.histogramEqualize(pixels, w, h);
      const thumb      = this.downsample(equalized, w, h, THUMB_W, THUMB_H);
      const templateBase64 = Buffer.from(thumb).toString('base64');

      this.logger.debug(`Scan captured (${w}×${h} → ${THUMB_W}×${THUMB_H})`);
      this.emit('scan', { templateBase64 } as ScanEvent);
    } catch (err: unknown) {
      this.logger.error('BIR parse failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  private histogramEqualize(pixels: Uint8Array, w: number, h: number): Uint8Array {
    const n = w * h;
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[pixels[i]]++;
    const cdf = new Uint32Array(256);
    cdf[0] = hist[0];
    for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
    const cdfMin = cdf.find((v) => v > 0) ?? 0;
    const out = new Uint8Array(n);
    const scale = n - cdfMin || 1;
    for (let i = 0; i < n; i++)
      out[i] = Math.round(((cdf[pixels[i]] - cdfMin) / scale) * 255);
    return out;
  }

  private downsample(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
    const out = new Uint8Array(dw * dh);
    const scaleX = sw / dw;
    const scaleY = sh / dh;
    for (let dy = 0; dy < dh; dy++) {
      for (let dx = 0; dx < dw; dx++) {
        const sx = dx * scaleX, sy = dy * scaleY;
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
        const fx = sx - x0, fy = sy - y0;
        out[dy * dw + dx] = Math.round(
          src[y0 * sw + x0] * (1 - fx) * (1 - fy) +
          src[y0 * sw + x1] *       fx  * (1 - fy) +
          src[y1 * sw + x0] * (1 - fx) *       fy  +
          src[y1 * sw + x1] *       fx  *       fy,
        );
      }
    }
    return out;
  }

  private setStatus(s: ScannerStatus) {
    this.status = s;
    this.emit('status', s);
  }
}
