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
  @ApiResponse({ status: 200, description: 'Array of hourly buckets' })
  daily() {
    return this.reportsService.daily();
  }

  @Get('weekly')
  @ApiOperation({ summary: 'Attendance count per day for the last 7 days' })
  @ApiResponse({ status: 200, description: 'Array of daily buckets (7 days)' })
  weekly() {
    return this.reportsService.weekly();
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Attendance count per day for the last 30 days' })
  @ApiResponse({ status: 200, description: 'Array of daily buckets (30 days)' })
  monthly() {
    return this.reportsService.monthly();
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Distinct employees per day for a calendar month' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number, description: '1–12' })
  @ApiResponse({ status: 200, description: 'Array of { date, count } for every day in the month' })
  calendarMonth(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const y = parseInt(year, 10) || new Date().getFullYear();
    const m = parseInt(month, 10) || new Date().getMonth() + 1;
    return this.reportsService.calendarMonth(y, m);
  }

  @Get('present-today')
  @ApiOperation({ summary: 'Distinct employees present vs absent today' })
  @ApiResponse({ status: 200, description: '{ present, total, absent }' })
  presentToday() {
    return this.reportsService.presentToday();
  }

  @Get('by-role')
  @ApiOperation({ summary: 'Check-ins today grouped by employee role' })
  @ApiResponse({ status: 200, description: 'Array of { role, count }' })
  byRole() {
    return this.reportsService.byRole();
  }

  @Get('export')
  @ApiOperation({ summary: 'Export attendance records as CSV' })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'Start date (ISO)' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'End date (ISO)' })
  @ApiResponse({ status: 200, description: 'CSV file download' })
  async exportCsv(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportCsv(from, to);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `attendance-${dateStr}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csv);
  }
}
