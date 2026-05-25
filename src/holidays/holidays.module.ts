import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Holiday } from './holiday.entity';
import { HolidaysService } from './holidays.service';
import { HolidaysController } from './holidays.controller';
import { AdminKeyGuard } from '../common/admin-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Holiday]), ConfigModule],
  providers: [HolidaysService, AdminKeyGuard],
  controllers: [HolidaysController],
  exports: [HolidaysService],
})
export class HolidaysModule {}
