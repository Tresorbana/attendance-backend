import { Global, Module } from '@nestjs/common';
import { DescriptorCache } from './descriptor-cache';

@Global()
@Module({
  providers: [DescriptorCache],
  exports: [DescriptorCache],
})
export class SharedModule {}
