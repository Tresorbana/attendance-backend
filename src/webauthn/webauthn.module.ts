import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebAuthnCredential } from './webauthn-credential.entity';
import { WebAuthnService } from './webauthn.service';
import { WebAuthnController } from './webauthn.controller';
import { PeopleModule } from '../people/people.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebAuthnCredential]),
    PeopleModule,
    AttendanceModule,
  ],
  providers: [WebAuthnService],
  controllers: [WebAuthnController],
  exports: [WebAuthnService],
})
export class WebAuthnModule {}
