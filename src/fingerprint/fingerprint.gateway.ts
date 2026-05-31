import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { FingerprintScannerService, ScanEvent, ScannerStatus } from './fingerprint-scanner.service';
import { RecognitionService } from '../recognition/recognition.service';

// Clients in 'enrollment' mode receive the next scan as a template, not as attendance
const enrollmentClients = new Set<WebSocket>();

@WebSocketGateway({ path: '/fingerprint' })
export class FingerprintGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(FingerprintGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly scanner: FingerprintScannerService,
    private readonly recognitionService: RecognitionService,
  ) {}

  onModuleInit() {
    this.scanner.on('status', (status: ScannerStatus) => {
      this.broadcast({ type: 'scanner_status', status });
    });

    this.scanner.on('scan', async (event: ScanEvent) => {
      // If any clients are waiting for enrollment capture, deliver to them first
      if (enrollmentClients.size > 0) {
        const msg = JSON.stringify({ type: 'scan_ready', template: event.templateBase64 });
        for (const client of enrollmentClients) {
          if (client.readyState === WebSocket.OPEN) client.send(msg);
        }
        enrollmentClients.clear();
        return;
      }

      // Otherwise run attendance recognition
      this.broadcast({ type: 'finger_detected' });
      try {
        const result = await this.recognitionService.recognize(event.templateBase64);
        this.broadcast({ type: 'attendance_result', ...result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Recognition error:', msg);
        this.broadcast({ type: 'attendance_result', matched: false, error: msg });
      }
    });
  }

  afterInit() {
    this.logger.log('Fingerprint WebSocket gateway started at /fingerprint');
  }

  handleConnection(client: WebSocket) {
    this.logger.debug('Client connected');
    // Send current scanner status immediately
    client.send(JSON.stringify({
      type: 'scanner_status',
      status: this.scanner.getStatus(),
    }));
  }

  handleDisconnect(client: WebSocket) {
    enrollmentClients.delete(client);
    this.logger.debug('Client disconnected');
  }

  @SubscribeMessage('arm_enrollment')
  handleArmEnrollment(@ConnectedSocket() client: WebSocket) {
    enrollmentClients.add(client);
    this.logger.debug('Client armed for enrollment capture');
    return { type: 'armed', mode: 'enrollment' };
  }

  @SubscribeMessage('cancel_enrollment')
  handleCancelEnrollment(@ConnectedSocket() client: WebSocket) {
    enrollmentClients.delete(client);
    return { type: 'cancelled' };
  }

  private broadcast(payload: object) {
    if (!this.server?.clients) return;
    const msg = JSON.stringify(payload);
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  }
}
