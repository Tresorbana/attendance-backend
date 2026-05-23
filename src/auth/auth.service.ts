import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';

export type AuthUser = {
  username: string;
  full_name: string;
};

@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  login(dto: LoginDto): AuthUser {
    const adminUsername = this.config.get<string>('ADMIN_USERNAME');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');
    const adminFullName =
      this.config.get<string>('ADMIN_FULL_NAME') || 'Administrator';

    if (!adminUsername || !adminPassword) {
      throw new InternalServerErrorException(
        'Admin login is not configured on the server.',
      );
    }

    if (
      dto.username.trim().toLowerCase() !== adminUsername.trim().toLowerCase() ||
      dto.password !== adminPassword
    ) {
      throw new UnauthorizedException('Incorrect username or password.');
    }

    return {
      username: adminUsername,
      full_name: adminFullName,
    };
  }
}
