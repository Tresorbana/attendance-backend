import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Station } from './station.entity';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Station])],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
