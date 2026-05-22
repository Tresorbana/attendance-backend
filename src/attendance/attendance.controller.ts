import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Get the last 10 attendance check-ins' })
  @ApiResponse({ status: 200, description: 'Array of recent attendance records' })
  getRecent() {
    return this.attendanceService.getRecent(10);
  }

  @Get()
  @ApiOperation({ summary: 'Get attendance records with optional filters' })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO date string (start)' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'ISO date string (end)' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name' })
  @ApiResponse({ status: 200, description: 'Array of attendance records' })
  getAll(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.attendanceService.getAll(from, to, search);
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
