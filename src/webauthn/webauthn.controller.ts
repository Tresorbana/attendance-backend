import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseIntPipe,
  Delete,
  Param,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { WebAuthnService } from './webauthn.service';

class RegisterVerifyDto {
  @IsString() @IsNotEmpty() state: string;
  @IsNumber() personId: number;
  @IsNotEmpty() response: RegistrationResponseJSON;
}

class AuthVerifyDto {
  @IsString() @IsNotEmpty() state: string;
  @IsNotEmpty() response: AuthenticationResponseJSON;
}

@ApiTags('webauthn')
@Controller('webauthn')
export class WebAuthnController {
  constructor(private readonly webauthn: WebAuthnService) {}

  // ── Employee fingerprint enrollment (admin page) ───────────────────────────

  @Get('register-options')
  @ApiOperation({ summary: 'Generate Windows Hello registration options for a person' })
  async getRegistrationOptions(@Query('personId', ParseIntPipe) personId: number) {
    return this.webauthn.getRegistrationOptions(personId);
  }

  @Post('register-verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify and store a Windows Hello credential for an employee' })
  async verifyRegistration(@Body() body: RegisterVerifyDto) {
    return this.webauthn.verifyRegistration(body.state, body.personId, body.response);
  }

  @Delete('credentials/:personId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete Windows Hello credential for a person (re-enroll)' })
  async deleteCredentials(@Param('personId', ParseIntPipe) personId: number) {
    await this.webauthn.deleteCredentialsForPerson(personId);
  }

  @Get('credentials/:personId')
  @ApiOperation({ summary: 'Check if a person has a registered credential' })
  async getCredentials(@Param('personId', ParseIntPipe) personId: number) {
    return this.webauthn.getCredentialsForPerson(personId);
  }

  // ── Employee clock-in / clock-out (live / portal page) ────────────────────

  @Post('auth-options')
  @HttpCode(200)
  @ApiOperation({ summary: 'Get Windows Hello authentication options (all enrolled employees)' })
  async getAuthOptions() {
    return this.webauthn.getAuthenticationOptions();
  }

  @Post('auth-verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify fingerprint scan and record attendance' })
  async verifyAuth(@Body() body: AuthVerifyDto) {
    return this.webauthn.verifyAuthentication(body.state, body.response);
  }
}
