import { Module, forwardRef } from '@nestjs/common';
import { FingerprintScannerService } from './fingerprint-scanner.service';
import { FingerprintGateway } from './fingerprint.gateway';
import { RecognitionModule } from '../recognition/recognition.module';

@Module({
  imports: [forwardRef(() => RecognitionModule)],
  providers: [FingerprintScannerService, FingerprintGateway],
  exports: [FingerprintScannerService, FingerprintGateway],
})
export class FingerprintModule {}
