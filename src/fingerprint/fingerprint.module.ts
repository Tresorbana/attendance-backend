import { Module } from '@nestjs/common';
import { FingerprintScannerService } from './fingerprint-scanner.service';
import { FingerprintGateway } from './fingerprint.gateway';
import { RecognitionModule } from '../recognition/recognition.module';

@Module({
  imports: [RecognitionModule],
  providers: [FingerprintScannerService, FingerprintGateway],
  exports: [FingerprintScannerService],
})
export class FingerprintModule {}
