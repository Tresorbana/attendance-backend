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
import { RecognitionService } from '../recognition/recognition.service';
import { rawImageToTemplate } from '../shared/image-utils';

@WebSocketGateway({ path: '/fingerprint' })
export class FingerprintGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(FingerprintGateway.name);

  @WebSocketServer()
  server!: Server;

  /** Set of WebSocket clients that requested an enrollment capture */
  private enrollmentClients = new Set<WebSocket>();

  constructor(
    private readonly scanner: FingerprintScannerService,
    private readonly recognition: RecognitionService,
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
    this.logger.debug('Client connected');
    client.send(JSON.stringify({
      type: 'scanner_status',
      status: this.scanner.getStatus(),
    }));
  }

  handleDisconnect(client: WebSocket) {
    this.logger.debug('Client disconnected');
    this.enrollmentClients.delete(client);
  }

  /**
   * Fingerprint template submitted directly by the browser-side DigitalPersona reader.
   * Runs recognition and broadcasts the attendance result to all connected clients.
   */
  @SubscribeMessage('fingerprint_sample')
  async handleFingerprintSample(_client: WebSocket, payload: { template: string }) {
    if (!payload?.template) return;
    try {
      const result = await this.recognition.recognize(payload.template);
      this.broadcastAttendance(result);
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

  /** Broadcast an attendance result to ALL clients (called by RecognitionController for HTTP path) */
  broadcastAttendance(payload: object) {
    this.broadcast({ type: 'attendance_result', ...payload });
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async handleScan(evt: ScanEvent) {
    let template: string | null = null;

    if (evt.width > 0 && evt.height > 0) {
      // Raw uncompressed grayscale — convert to 96×96 template
      try {
        template = rawImageToTemplate(evt.width, evt.height, evt.data);
      } catch (err) {
        this.logger.error(`Template generation failed: ${err}`);
      }
    } else if (evt.width === -1) {
      // Compressed block (e.g. PNG from ANSI 381) — forward as-is for future handling
      this.logger.warn(
        `Received compressed fingerprint block (comprAlg=${evt.height}). ` +
        'Raw grayscale parsing expected — check ANSI 381 layout.',
      );
      return;
    } else {
      this.logger.warn(`Received raw BIR (width=${evt.width}) — cannot parse.`);
      return;
    }

    if (!template) return;

    // Run recognition and broadcast attendance result
    try {
      const result = await this.recognition.recognize(template);
      this.broadcastAttendance(result);
    } catch (err) {
      this.logger.error(`Recognition failed: ${err}`);
    }

    // Deliver template to any waiting enrollment clients
    if (this.enrollmentClients.size > 0) {
      const msg = JSON.stringify({ type: 'enrollment_capture', template });
      const dead: WebSocket[] = [];
      for (const client of this.enrollmentClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        } else {
          dead.push(client);
        }
      }
      dead.forEach((c) => this.enrollmentClients.delete(c));
      this.enrollmentClients.clear(); // one-shot: clear after delivery
    }
  }

  private broadcast(payload: object) {
    if (!this.server?.clients) return;
    const msg = JSON.stringify(payload);
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
}
