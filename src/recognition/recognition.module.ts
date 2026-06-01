import { Module, forwardRef } from '@nestjs/common';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { PeopleModule } from '../people/people.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { FingerprintModule } from '../fingerprint/fingerprint.module';

@Module({
  imports: [PeopleModule, AttendanceModule, forwardRef(() => FingerprintModule)],
  providers: [RecognitionService],
  controllers: [RecognitionController],
  exports: [RecognitionService],
})
export class RecognitionModule {}
