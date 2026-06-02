/**
 * FingerprintScannerService
 *
 * Spawns FingerprintBridge.exe (compiled C# — see bridge/), reads its JSON
 * stdout lines, and emits typed events:
 *
 *   'status'       (ScannerStatus)
 *   'scan'         ({ width: number; height: number; data: Buffer })
 *   'quality'      ({ reject: string })
 *   'bridge_error' ({ code: string; message: string })
 *
 * The service restarts the bridge process automatically after a crash
 * (with exponential back-off up to 30 s).
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as readline from 'readline';

export type ScannerStatus = 'disconnected' | 'ready' | 'scanning' | 'error';

export interface ScanEvent {
  /** Pixel width of the raw grayscale image (-1 = compressed block, -2 = raw BIR) */
  width: number;
  /** Pixel height (or compression algorithm id when width === -1) */
  height: number;
  /** Raw grayscale bytes OR compressed block, depending on width */
  data: Buffer;
}

// __dirname in compiled output: <root>/dist/fingerprint
// Two levels up reaches the project root, then into bridge/
const BRIDGE_PATH = path.join(__dirname, '..', '..', 'bridge', 'FingerprintBridge.exe');

@Injectable()
export class FingerprintScannerService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FingerprintScannerService.name);
  private status: ScannerStatus = 'disconnected';
  private bridge: ChildProcess | null = null;
  private destroyed = false;
  private retryDelay = 2000;
  private consecutiveErrors = 0;

  async onModuleInit() {
    this.startBridge();
  }

  async onModuleDestroy() {
    this.destroyed = true;
    this.bridge?.kill();
    this.bridge = null;
  }

  getStatus(): ScannerStatus {
    return this.status;
  }

  // ── Bridge process management ───────────────────────────────────────────

  private startBridge() {
    if (this.destroyed) return;

    this.logger.log(`Starting fingerprint bridge: ${BRIDGE_PATH}`);

    let proc: ChildProcess;
    try {
      proc = spawn(BRIDGE_PATH, [], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      this.logger.error(`Failed to spawn bridge: ${err}`);
      this.setStatus('error');
      this.scheduleRestart();
      return;
    }

    this.bridge = proc;

    const rl = readline.createInterface({ input: proc.stdout! });
    rl.on('line', (line) => this.handleLine(line));

    proc.stderr!.on('data', (d: Buffer) => {
      this.logger.warn(`Bridge stderr: ${d.toString().trim()}`);
    });

    proc.on('exit', (code, signal) => {
      this.logger.warn(`Bridge exited (code=${code}, signal=${signal})`);
      this.bridge = null;
      // Keep 'error' status if the bridge was killed due to persistent errors —
      // resetting to 'disconnected' would show a misleading "unplug" message on the frontend.
      if (this.status !== 'error') {
        this.setStatus('disconnected');
      }
      if (!this.destroyed) this.scheduleRestart();
    });

    proc.on('error', (err) => {
      this.logger.error(`Bridge error: ${err.message}`);
      this.bridge = null;
      this.setStatus('error');
      if (!this.destroyed) this.scheduleRestart();
    });
  }

  private scheduleRestart() {
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    this.logger.log(`Restarting bridge in ${delay}ms…`);
    setTimeout(() => this.startBridge(), delay);
  }

  // ── JSON line parser ────────────────────────────────────────────────────

  private handleLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.debug(`Bridge non-JSON: ${line}`);
      return;
    }

    switch (msg.type) {
      case 'status':
        this.retryDelay = 2000; // reset back-off on successful connect
        this.consecutiveErrors = 0;
        this.setStatus(msg.status === 'ready' ? 'ready' : 'disconnected');
        break;

      case 'scan': {
        this.setStatus('scanning');
        const evt: ScanEvent = {
          width: msg.width,
          height: msg.height,
          data: Buffer.from(msg.data as string, 'base64'),
        };
        this.emit('scan', evt);
        // Return to ready after emitting
        setTimeout(() => this.setStatus('ready'), 0);
        break;
      }

      case 'quality':
        this.logger.debug(`Bad capture, reject: ${msg.reject}`);
        this.emit('quality', { reject: msg.reject });
        break;

      case 'error': {
        this.logger.error(`Bridge error [${msg.code}]: ${msg.message}`);
        this.setStatus('error');
        this.emit('bridge_error', { code: msg.code, message: msg.message });

        if (msg.code === 'ACCESS_DENIED_FATAL') {
          // Both raw and intermediate capture were denied — retrying immediately is
          // pointless. Apply a 5-minute back-off and kill the bridge; the exit
          // handler will schedule a restart.
          this.logger.warn(
            `Access denied for all capture modes — pausing 5 min before retry. ` +
            `To fix: run bridge/setup-scanner-admin.bat as Administrator.`,
          );
          this.retryDelay = 300_000;
          this.bridge?.kill();
          break;
        }

        this.consecutiveErrors++;
        if (this.consecutiveErrors === 10) {
          this.logger.warn(
            `Bridge reporting persistent errors [${msg.code}] — pausing 5 min before retry. ` +
            `To fix immediately: run bridge/setup-scanner-admin.bat as Administrator.`,
          );
          this.retryDelay = 300_000;
          this.consecutiveErrors = 0;
          this.bridge?.kill();
        }
        break;
      }

      default:
        this.logger.debug(`Unknown bridge message: ${line}`);
    }
  }

  // ── Status helpers ──────────────────────────────────────────────────────

  private setStatus(s: ScannerStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }
}
