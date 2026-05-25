import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { StationsService } from '../stations/stations.service';

export type UserRole = 'super-admin' | 'station-admin';

export type AuthUser = {
  username: string;
  full_name: string;
  role: UserRole;
  /** Populated only for station-admin */
  station: string | null;
  stationId: number | null;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly stationsService: StationsService,
  ) {}

  async login(dto: LoginDto): Promise<AuthUser> {
    const adminUsername = this.config.get<string>('ADMIN_USERNAME');
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');
    const adminFullName =
      this.config.get<string>('ADMIN_FULL_NAME') || 'Administrator';

    if (!adminUsername || !adminPassword) {
      throw new InternalServerErrorException(
        'Admin login is not configured on the server.',
      );
    }

    // ── 1. Check super-admin credentials ────────────────────────────────────
    if (
      dto.username.trim().toLowerCase() === adminUsername.trim().toLowerCase() &&
      dto.password === adminPassword
    ) {
      return {
        username: adminUsername,
        full_name: adminFullName,
        role: 'super-admin',
        station: null,
        stationId: null,
      };
    }

    // ── 2. Check station-admin credentials ──────────────────────────────────
    const station = await this.stationsService.findByAdminUsername(
      dto.username.trim(),
    );

    if (station && station.adminPassword === dto.password) {
      return {
        username: station.adminUsername!,
        full_name: station.adminFullName || station.name,
        role: 'station-admin',
        station: station.name,
        stationId: station.id,
      };
    }

    throw new UnauthorizedException('Incorrect username or password.');
  }
}
