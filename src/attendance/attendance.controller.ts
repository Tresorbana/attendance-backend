import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { AttendanceType } from './attendance.entity';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Get the last 10 attendance records' })
  @ApiResponse({ status: 200, description: 'Array of recent attendance records' })
  getRecent() {
    return this.attendanceService.getRecent(10);
  }

  @Get()
  @ApiOperation({ summary: 'Get attendance records with optional filters' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'personId', required: false, type: Number })
  @ApiQuery({ name: 'station', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: ['check-in', 'check-out'] })
  @ApiResponse({ status: 200, description: 'Array of attendance records' })
  getAll(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('personId') personId?: string,
    @Query('station') station?: string,
    @Query('type') type?: AttendanceType,
  ) {
    return this.attendanceService.getAll(
      from,
      to,
      search,
      personId ? parseInt(personId, 10) : undefined,
      station,
      type,
    );
  }
}

/**
 * Stats controller — handles GET /api/stats at the root API level.
 */
@ApiTags('attendance')
@Controller()
export class StatsController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dashboard statistics' })
  @ApiResponse({
    status: 200,
    description: '{ totalPeople, todayCount, attendanceRate, lastCheckIn }',
  })
  getStats() {
    return this.attendanceService.getStats();
  }
}
