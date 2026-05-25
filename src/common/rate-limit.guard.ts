import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';

interface BucketEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter.
 * Limits requests per IP per time window.
 * For multi-instance deployments, replace with Redis-backed throttling.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, BucketEntry>();

  constructor(
    private readonly maxRequests: number = 10,
    private readonly windowMs: number = 60_000, // 1 minute
  ) {
    // Clean up stale entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60_000);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    const now = Date.now();
    const entry = this.buckets.get(ip);

    if (!entry || now > entry.resetAt) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    entry.count++;
    if (entry.count > this.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many requests. Try again in ${retryAfter} seconds.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.buckets.entries()) {
      if (now > entry.resetAt) this.buckets.delete(ip);
    }
  }
}

/** Factory: 5 login attempts per minute per IP */
export const AuthRateLimitGuard = new RateLimitGuard(5, 60_000);

/** Factory: 30 requests per minute for general API */
export const ApiRateLimitGuard = new RateLimitGuard(30, 60_000);
