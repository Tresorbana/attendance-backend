import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { AttendanceType } from './attendance.entity';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('recent')
  @ApiOperation({ summary: 'Get the last 20 attendance records, optionally scoped to a station' })
  @ApiQuery({ name: 'station', required: false, type: String })
  getRecent(@Query('station') station?: string) {
    return this.attendanceService.getRecent(20, station);
  }

  @Get()
  @ApiOperation({ summary: 'Get attendance records with optional filters' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'personId', required: false, type: Number })
  @ApiQuery({ name: 'station', required: false, type: String })
  @ApiQuery({ name: 'type', required: false, enum: ['check-in', 'check-out'] })
  getAll(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('personId') personId?: string,
    @Query('station') station?: string,
    @Query('type') type?: AttendanceType,
  ) {
    return this.attendanceService.getAll(
      from, to, search,
      personId ? parseInt(personId, 10) : undefined,
      station, type,
    );
  }
}

@ApiTags('attendance')
@Controller()
export class StatsController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard statistics, optionally scoped to a station' })
  @ApiQuery({ name: 'station', required: false, type: String })
  @ApiResponse({ status: 200, description: '{ totalPeople, todayCount, attendanceRate, lastCheckIn }' })
  getStats(@Query('station') station?: string) {
    return this.attendanceService.getStats(station);
  }
}
