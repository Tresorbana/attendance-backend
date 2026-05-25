import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { HolidaysService, CreateHolidayDto } from './holidays.service';
import { AdminKeyGuard } from '../common/admin-key.guard';

@ApiTags('holidays')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  @Get()
  @ApiOperation({ summary: 'List all holidays, optionally filtered by year' })
  @ApiQuery({ name: 'year', required: false, type: Number })
  findAll(@Query('year') year?: string) {
    if (year) return this.holidaysService.findByYear(parseInt(year, 10));
    return this.holidaysService.findAll();
  }

  /**
   * Seed endpoint — protected by X-Admin-Key.
   * Call from server: curl -X POST -H "X-Admin-Key: <ADMIN_PASSWORD>" /api/holidays/seed/2026
   */
  @Post('seed/:year')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminKeyGuard)
  @ApiOperation({ summary: 'Seed Rwanda public holidays (X-Admin-Key required)' })
  @ApiHeader({ name: 'X-Admin-Key', description: 'Must match ADMIN_PASSWORD', required: true })
  @ApiParam({ name: 'year', type: Number })
  async seed(@Param('year', ParseIntPipe) year: number) {
    await this.holidaysService.seedDefaults(year);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a holiday' })
  create(@Body() dto: CreateHolidayDto) {
    return this.holidaysService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a holiday' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateHolidayDto>,
  ) {
    return this.holidaysService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a holiday' })
  @ApiParam({ name: 'id', type: Number })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.holidaysService.remove(id);
  }
}
