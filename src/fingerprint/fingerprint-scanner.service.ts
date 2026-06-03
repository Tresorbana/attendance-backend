/**
 * FingerprintScannerService
 *
 * Preferred path: connects to the AttendAI fingerprint Windows Service via
 * the named pipe \\.\pipe\AttendAIFingerprint (no admin rights needed on
 * the NestJS side — the service runs as LocalSystem).
 *
 * Fallback path: spawns FingerprintBridge.exe directly (requires the
 * service to NOT be installed, or for developer use).
 *
 * Emits typed events in both paths:
 *   'status'       (ScannerStatus)
 *   'scan'         ({ width: number; height: number; data: Buffer })
 *   'quality'      ({ reject: string })
 *   'bridge_error' ({ code: string; message: string })
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as readline from 'readline';
import { promisify } from 'util';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ScannerStatus = 'disconnected' | 'ready' | 'scanning' | 'error';

export interface ScanEvent {
  /** Pixel width of the raw grayscale image (-1 = compressed block, -2 = raw BIR) */
  width: number;
  /** Pixel height (or compression algorithm id when width === -1) */
  height: number;
  /** Raw grayscale bytes OR compressed block, depending on width */
  data: Buffer;
}

// Named pipe served by the scheduled-task bridge process
const SERVICE_PIPE    = '\\\\.\\pipe\\AttendAIFingerprint';
const SCHEDULED_TASK  = 'AttendAIFingerprintBridge';

// Fallback: spawn the exe directly (when task is not set up yet)
const BRIDGE_EXE = path.join(__dirname, '..', '..', 'bridge', 'FingerprintBridge.exe');

// Timeout waiting for a single pipe connection attempt (ms)
const PIPE_CONNECT_TIMEOUT = 3_000;

@Injectable()
export class FingerprintScannerService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FingerprintScannerService.name);

  private status: ScannerStatus = 'disconnected';
  private destroyed = false;
  private retryDelay = 2_000;
  private consecutiveErrors = 0;

  // Named-pipe (service) mode
  private pipeSocket: net.Socket | null = null;

  // Exe (fallback) mode
  private bridge: ChildProcess | null = null;

  async onModuleInit() {
    this.startBridge();
  }

  async onModuleDestroy() {
    this.destroyed = true;
    this.pipeSocket?.destroy();
    this.pipeSocket = null;
    this.bridge?.kill();
    this.bridge = null;
  }

  getStatus(): ScannerStatus {
    return this.status;
  }

  // ── Entry point ─────────────────────────────────────────────────────────

  private startBridge() {
    if (this.destroyed) return;
    void this.startBridgeAsync();
  }

  private async startBridgeAsync() {
    if (this.destroyed) return;

    // 1. Try the named pipe — task may already be running (logon trigger fired)
    if (await this.tryServicePipe()) return;

    // 2. Ask the scheduler to start the task (no admin needed for own tasks)
    this.logger.log('Triggering fingerprint bridge scheduled task…');
    await this.triggerScheduledTask();

    // 3. Wait for the process to start and create the pipe
    await sleep(3_000);
    if (this.destroyed) return;

    // 4. Try pipe again
    if (await this.tryServicePipe()) return;

    // 5. Nothing worked — fall back to spawning the exe directly
    this.logger.warn(
      'Scheduled task unavailable — falling back to direct exe spawn. ' +
      'Run bridge/setup-bridge-service.bat as Administrator to set up the task.',
    );
    this.startBridgeExe();
  }

  /** Triggers the scheduled task; resolves when schtasks exits (fire-and-forget). */
  private triggerScheduledTask(): Promise<void> {
    return new Promise<void>((resolve) => {
      const proc = spawn('schtasks', ['/run', '/tn', SCHEDULED_TASK], {
        shell: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      const timer = setTimeout(() => { proc.kill(); resolve(); }, 5_000);
      proc.on('close', () => { clearTimeout(timer); resolve(); });
      proc.on('error', () => { clearTimeout(timer); resolve(); });
    });
  }

  private scheduleRestart() {
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
    this.logger.log(`Restarting bridge in ${delay} ms…`);
    setTimeout(() => this.startBridge(), delay);
  }

  // ── Named-pipe (service) mode ────────────────────────────────────────────

  /**
   * Try to connect to the Windows Service named pipe.
   * Resolves true if connected, false if the service is not available.
   */
  private tryServicePipe(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection(SERVICE_PIPE);

      const timer = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, PIPE_CONNECT_TIMEOUT);

      socket.once('connect', () => {
        clearTimeout(timer);
        this.logger.log('Connected to fingerprint service via named pipe');
        this.retryDelay = 2_000;
        this.consecutiveErrors = 0;
        this.setupPipeSocket(socket);
        resolve(true);
      });

      socket.once('error', () => {
        clearTimeout(timer);
        // Service not installed or not running — use exe fallback
        resolve(false);
      });
    });
  }

  private setupPipeSocket(socket: net.Socket) {
    this.pipeSocket = socket;

    const rl = readline.createInterface({ input: socket });
    rl.on('line', (line) => this.handleLine(line));

    socket.on('close', () => {
      this.logger.warn('Fingerprint service pipe closed');
      this.pipeSocket = null;
      rl.close();
      if (this.status !== 'error') this.setStatus('disconnected');
      if (!this.destroyed) this.scheduleRestart();
    });

    socket.on('error', (err: Error) => {
      this.logger.error(`Pipe socket error: ${err.message}`);
      this.pipeSocket = null;
      rl.close();
      this.setStatus('error');
      if (!this.destroyed) this.scheduleRestart();
    });
  }

  // ── Exe (fallback) mode ──────────────────────────────────────────────────

  private startBridgeExe() {
    if (this.destroyed) return;

    this.logger.log(`Starting fingerprint bridge exe: ${BRIDGE_EXE}`);

    let proc: ChildProcess;
    try {
      proc = spawn(BRIDGE_EXE, [], { stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (this.status !== 'error') this.setStatus('disconnected');
      if (!this.destroyed) this.scheduleRestart();
    });

    proc.on('error', (err) => {
      this.logger.error(`Bridge process error: ${err.message}`);
      this.bridge = null;
      this.setStatus('error');
      if (!this.destroyed) this.scheduleRestart();
    });
  }

  // ── JSON line parser (shared by both pipe and exe paths) ─────────────────

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
        this.retryDelay = 2_000;
        this.consecutiveErrors = 0;
        this.setStatus(msg.status === 'ready' ? 'ready' : 'disconnected');
        break;

      case 'scan': {
        this.setStatus('scanning');
        const evt: ScanEvent = {
          width:  msg.width,
          height: msg.height,
          data:   Buffer.from(msg.data as string, 'base64'),
        };
        this.emit('scan', evt);
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

        const fatalCodes = ['ACCESS_DENIED_FATAL', 'ELEVATION_FAILED', 'PIPE_TIMEOUT'];
        if (fatalCodes.includes(msg.code)) {
          this.logger.warn(
            `Scanner access error [${msg.code}] — pausing 5 min. ` +
            `Run bridge/setup-bridge-service.bat as Administrator to fix permanently.`,
          );
          this.retryDelay = 300_000;
          this.bridge?.kill();
          break;
        }

        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 10) {
          this.logger.warn(
            `Persistent scanner errors [${msg.code}] — pausing 5 min. ` +
            `Check that the DigitalPersona U.are.U 4500 is plugged in.`,
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

  // ── Status helpers ───────────────────────────────────────────────────────

  private setStatus(s: ScannerStatus) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }
}
