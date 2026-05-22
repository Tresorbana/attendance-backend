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

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const filename = `attendance-${dateStr}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(csv);
  }
}
