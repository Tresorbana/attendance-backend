import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RateLimitGuard } from '../common/rate-limit.guard';

// 5 login attempts per minute per IP
const loginRateLimit = new RateLimitGuard(5, 60_000);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(loginRateLimit)
  @ApiOperation({ summary: 'Authenticate a super-admin or station-admin' })
  @ApiResponse({ status: 200, description: 'Authenticated user with role and station info' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  login(@Body() dto: LoginDto): Promise<AuthUser> {
    return this.authService.login(dto);
  }
}
