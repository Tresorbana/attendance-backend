import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { FingerprintScannerService, ScannerStatus, ScanEvent } from './fingerprint-scanner.service';
import { RecognitionService, AttendanceMode } from '../recognition/recognition.service';
import { PythonPipelineService } from './python-pipeline.service';
import { isPngBase64 } from '../shared/image-utils';

@WebSocketGateway({ path: '/fingerprint' })
export class FingerprintGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(FingerprintGateway.name);

  @WebSocketServer()
  server!: Server;

  /** Set of WebSocket clients that requested an enrollment capture */
  private enrollmentClients = new Set<WebSocket>();

  /**
   * Optional mode override for the NEXT scan. Reset to 'auto' after every
   * recognition. Allows a station admin to record breaks explicitly without
   * relying on the state-machine default.
   */
  private nextMode: AttendanceMode = 'auto';

  constructor(
    private readonly scanner: FingerprintScannerService,
    private readonly recognition: RecognitionService,
    private readonly pythonPipeline: PythonPipelineService,
  ) {}

  onModuleInit() {
    this.scanner.on('status', (status: ScannerStatus) => {
      this.broadcast({ type: 'scanner_status', status });
    });

    this.scanner.on('scan', (evt: ScanEvent) => {
      void this.handleScan(evt);
    });
  }

  afterInit() {
    this.logger.log('Fingerprint WebSocket gateway started at /fingerprint');
  }

  handleConnection(client: WebSocket) {
    const status = this.scanner.getStatus();
    this.logger.debug(`Client connected — scanner status: ${status}`);
    client.send(JSON.stringify({ type: 'scanner_status', status }));
  }

  handleDisconnect(client: WebSocket) {
    this.logger.debug('Client disconnected');
    this.enrollmentClients.delete(client);
  }

  /**
   * Fingerprint template submitted by the browser-side DigitalPersona reader.
   * Python pipeline is the sole matcher — must receive a PNG base64 image.
   */
  @SubscribeMessage('fingerprint_sample')
  async handleFingerprintSample(_client: WebSocket, payload: { template: string }) {
    if (!payload?.template) return;
    try {
      if (!isPngBase64(payload.template)) {
        this.logger.warn('fingerprint_sample rejected: not a PNG — Python pipeline requires PNG images');
        this.broadcastAttendance({ matched: false, error: 'non_png_rejected' });
        return;
      }

      this.broadcast({ type: 'processing' });
      await this.runPythonIdentify(payload.template);
    } catch (err) {
      this.logger.error(`Browser fingerprint recognition failed: ${err}`);
    }
  }

  /** Called from live page to confirm enrollment capture readiness */
  @SubscribeMessage('arm_enrollment')
  handleArmEnrollment(_client: WebSocket) {
    this.enrollmentClients.add(_client);
    _client.send(JSON.stringify({ type: 'enrollment_armed' }));
  }

  @SubscribeMessage('cancel_enrollment')
  handleCancelEnrollment(client: WebSocket) {
    this.enrollmentClients.delete(client);
  }

  /**
   * Set the action mode for the next scan. Used by the live page to record
   * break-start / break-end / explicit check-out.  Resets to 'auto' after
   * the next recognition completes.
   */
  @SubscribeMessage('set_mode')
  handleSetMode(_client: WebSocket, payload: { mode?: AttendanceMode }) {
    const valid: AttendanceMode[] = ['auto', 'break-start', 'break-end', 'check-out'];
    const mode = payload?.mode;
    if (mode && valid.includes(mode)) {
      this.nextMode = mode;
      this.broadcast({ type: 'mode_set', mode });
    }
  }

  /** Broadcast an attendance result to ALL clients (called by RecognitionController for HTTP path) */
  broadcastAttendance(payload: object) {
    this.broadcast({ type: 'attendance_result', ...payload });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async handleScan(evt: ScanEvent) {
    this.logger.debug(`Scan received — width=${evt.width} height=${evt.height} bytes=${evt.data.length}`);

    // ── Encode raw grayscale → PNG for Python ─────────────────────────────────
    let pngBase64: string | null = null;

    if (evt.width > 0 && evt.height > 0) {
      try {
        pngBase64 = await this.pythonPipeline.rawGrayToPng(
          evt.width, evt.height, evt.data,
        );
      } catch (err) {
        this.logger.error(`PNG encoding failed: ${err}`);
        this.broadcastAttendance({ matched: false, error: 'image_encoding_failed' });
        return;
      }
    } else if (evt.width === -1) {
      // Intermediate-mode capture: compressed image bytes (PNG/JPEG2000/WSQ)
      // comprAlg is encoded in evt.height (3=PNG, 2=JPEG2000, 4=WSQ)
      pngBase64 = await this.pythonPipeline.compressedImageToPng(evt.data);
      if (!pngBase64) {
        this.logger.warn(
          `Unsupported compressed fingerprint format (comprAlg=${evt.height}) — ` +
          'WSQ requires an additional decoder. Run NestJS as Administrator for raw capture.',
        );
        this.broadcastAttendance({ matched: false, error: 'unsupported_compression' });
        return;
      }
      this.logger.debug(`Decoded compressed fingerprint (comprAlg=${evt.height}) to PNG`);
    } else {
      this.logger.warn(`Received raw BIR (width=${evt.width}) — cannot parse. Broadcasting error to clients.`);
      this.broadcastAttendance({ matched: false, error: 'bir_parse_failed' });
      return;
    }

    if (!pngBase64) return;

    // ── Signal clients to show processing animation ───────────────────────────
    this.broadcast({ type: 'processing' });

    // ── Recognition ──────────────────────────────────────────────────────────
    try {
      await this.runPythonIdentify(pngBase64);
    } catch (err) {
      this.logger.error(`Recognition failed: ${err}`);
    }

    // ── Deliver PNG to enrollment clients ─────────────────────────────────────
    if (this.enrollmentClients.size > 0) {
      const msg = JSON.stringify({ type: 'enrollment_capture', template: pngBase64 });
      const dead: WebSocket[] = [];
      for (const client of this.enrollmentClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        } else {
          dead.push(client);
        }
      }
      dead.forEach((c) => this.enrollmentClients.delete(c));
      this.enrollmentClients.clear();
    }
  }

  /**
   * Core Python identification + attendance recording shared by both scan paths.
   *
   * Priority order:
   *   1. Python pipeline (SourceAFIS BFS — most accurate)
   *   2. TS fallback (Dice-coefficient MPA) — used when Python is unavailable or
   *      returns no_match (e.g. person enrolled in NestJS before Python was running)
   *
   * The TS fallback is a bridge: once a person re-enrolls their fingerprint via the
   * enrollment page while Python is running, Python will take over permanently.
   */
  async runPythonIdentify(pngBase64: string): Promise<void> {
    if (!this.pythonPipeline.isEnabled()) {
      this.logger.warn('PYTHON_PIPELINE_URL not configured — falling back to TS recognition');
      await this.runTsFallback(pngBase64, 'ts');
      return;
    }

    const pyResult = await this.pythonPipeline.identify(pngBase64);

    if (!pyResult) {
      this.logger.error('Python pipeline did not respond — falling back to TS recognition');
      const tsMatched = await this.runTsFallback(pngBase64, 'ts_fallback');
      if (!tsMatched) {
        this.broadcastAttendance({ matched: false, error: 'pipeline_unavailable' });
      }
      return;
    }

    if (pyResult.flag === 'low_confidence') {
      this.logger.warn(
        `Low-confidence match person_id=${pyResult.person_id} score=${pyResult.confidence_score} — not recording`,
      );
      this.broadcastAttendance({ matched: false, flag: 'low_confidence', pipeline: 'python' });
      return;
    }

    if (!pyResult.matched || !pyResult.person_id) {
      // Python returned no_match — try TS for people not yet enrolled in Python
      const tsMatched = await this.runTsFallback(pngBase64, 'ts_fallback');
      if (!tsMatched) {
        this.broadcastAttendance({ matched: false, flag: pyResult.flag, pipeline: 'python' });
      }
      return;
    }

    const personId = parseInt(pyResult.person_id, 10);
    if (isNaN(personId)) {
      this.logger.error(`Python returned non-numeric person_id: ${pyResult.person_id}`);
      this.broadcastAttendance({ matched: false, error: 'invalid_person_id' });
      return;
    }

    // Consume any one-shot mode override (auto-reset after use)
    const mode = this.nextMode;
    this.nextMode = 'auto';

    const result = await this.recognition.recordAttendanceByPersonId(
      personId,
      pyResult.confidence_score,
      mode,
    );
    this.broadcastAttendance({ ...result, pipeline: 'python', mode });
  }

  /**
   * TS-based recognition fallback.  Uses the NestJS-stored minutiae templates and
   * the Dice-coefficient matcher (safe: denominator = P+C, not just P).
   *
   * Returns true when a match was found and attendance was recorded.
   * Logs a warning for every TS match so operators know who needs Python re-enrollment.
   */
  private async runTsFallback(
    pngBase64: string,
    pipelineLabel: string,
  ): Promise<boolean> {
    try {
      const result = await this.recognition.recognize(pngBase64);
      if (result.matched) {
        this.logger.warn(
          `TS fallback matched "${result.name}" (person_id=${result.person_id}) — ` +
          `re-enroll via the enrollment page to use the Python pipeline`,
        );
        this.broadcastAttendance({ ...result, pipeline: pipelineLabel });
        return true;
      }
    } catch (err) {
      this.logger.error(`TS fallback recognition failed: ${err}`);
    }
    return false;
  }

  private broadcast(payload: object) {
    if (!this.server?.clients) return;
    const msg = JSON.stringify(payload);
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
}
