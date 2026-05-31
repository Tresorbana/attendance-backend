import { Global, Module } from '@nestjs/common';
import { FingerprintCache } from './fingerprint-cache';

@Global()
@Module({
  providers: [FingerprintCache],
  exports: [FingerprintCache],
})
export class SharedModule {}
