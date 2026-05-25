import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Protects sensitive admin-only endpoints (seed, bulk operations).
 * Requires the X-Admin-Key header to match ADMIN_PASSWORD from env.
 *
 * Usage: @UseGuards(AdminKeyGuard) on controller methods.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers['x-admin-key'] as string | undefined;
    const adminPassword = this.config.get<string>('ADMIN_PASSWORD');

    if (!adminPassword) {
      throw new UnauthorizedException('Admin key not configured.');
    }

    if (!key || key !== adminPassword) {
      throw new UnauthorizedException('Invalid or missing X-Admin-Key header.');
    }

    return true;
  }
}
