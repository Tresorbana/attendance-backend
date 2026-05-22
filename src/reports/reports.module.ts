import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { PeopleModule } from '../people/people.module';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance]), PeopleModule],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
