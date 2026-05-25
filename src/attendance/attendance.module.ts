import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attendance } from './attendance.entity';
import { Person } from '../people/people.entity';
import { AttendanceService } from './attendance.service';
import { AttendanceController, StatsController } from './attendance.controller';
import { PeopleModule } from '../people/people.module';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance, Person]), PeopleModule],
  providers: [AttendanceService],
  controllers: [AttendanceController, StatsController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
