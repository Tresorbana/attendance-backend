import { Global, Module } from '@nestjs/common';
import { FingerprintCache } from './fingerprint-cache';
import { PythonPipelineService } from '../fingerprint/python-pipeline.service';

@Global()
@Module({
  providers: [FingerprintCache, PythonPipelineService],
  exports: [FingerprintCache, PythonPipelineService],
})
export class SharedModule {}
