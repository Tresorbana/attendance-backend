import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Station } from './station.entity';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';
import { AdminKeyGuard } from '../common/admin-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Station]), ConfigModule],
  controllers: [StationsController],
  providers: [StationsService, AdminKeyGuard],
  exports: [StationsService],
})
export class StationsModule {}
