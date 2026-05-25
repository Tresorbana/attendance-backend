import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily')
  @ApiOperation({ summary: 'Attendance count per hour for today' })
  daily() {
    return this.reportsService.daily();
  }

  @Get('weekly')
  @ApiOperation({ summary: 'Attendance count per day for the last 7 days' })
  weekly() {
    return this.reportsService.weekly();
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Attendance count per day for the last 30 days' })
  monthly() {
    return this.reportsService.monthly();
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Distinct employees per day for a calendar month' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  calendarMonth(@Query('year') year: string, @Query('month') month: string) {
    const y = parseInt(year, 10) || new Date().getFullYear();
    const m = parseInt(month, 10) || new Date().getMonth() + 1;
    return this.reportsService.calendarMonth(y, m);
  }

  @Get('present-today')
  @ApiOperation({ summary: 'Distinct employees present vs absent today, optionally scoped to a station' })
  @ApiQuery({ name: 'station', required: false, type: String })
  presentToday(@Query('station') station?: string) {
    return this.reportsService.presentToday(station);
  }

  @Get('by-role')
  @ApiOperation({ summary: 'Check-ins today grouped by employee role' })
  byRole() {
    return this.reportsService.byRole();
  }

  @Get('working-hours')
  @ApiOperation({ summary: 'Monthly working hours report per employee' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number, description: '1–12' })
  @ApiQuery({ name: 'station', required: false, type: String })
  @ApiQuery({ name: 'personId', required: false, type: Number })
  workingHours(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('station') station?: string,
    @Query('personId') personId?: string,
  ) {
    const y = parseInt(year, 10) || new Date().getFullYear();
    const m = parseInt(month, 10) || new Date().getMonth() + 1;
    return this.reportsService.monthlyWorkingHours(
      y,
      m,
      station,
      personId ? parseInt(personId, 10) : undefined,
    );
  }

  @Get('export')
  @ApiOperation({ summary: 'Export attendance records as CSV' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  async exportCsv(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportCsv(from, to);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sams-attendance-${dateStr}.csv"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csv);
  }

  @Get('export-monthly')
  @ApiOperation({ summary: 'Export monthly working hours report as CSV' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  @ApiQuery({ name: 'station', required: false, type: String })
  async exportMonthlyCsv(
    @Query('year') year: string,
    @Query('month') month: string,
    @Query('station') station: string | undefined,
    @Res() res: Response,
  ) {
    const y = parseInt(year, 10) || new Date().getFullYear();
    const m = parseInt(month, 10) || new Date().getMonth() + 1;
    const csv = await this.reportsService.exportMonthlyWorkingHoursCsv(y, m, station);
    const monthStr = `${y}-${String(m).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sams-working-hours-${monthStr}.csv"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csv);
  }
}
