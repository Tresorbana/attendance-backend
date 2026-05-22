import { Module } from '@nestjs/common';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { PeopleModule } from '../people/people.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [PeopleModule, AttendanceModule],
  providers: [RecognitionService],
  controllers: [RecognitionController],
})
export class RecognitionModule {}
