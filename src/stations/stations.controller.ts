import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { StationsService } from './stations.service';
import { CreateStationDto } from './dto/create-station.dto';
import { AdminKeyGuard } from '../common/admin-key.guard';

@ApiTags('stations')
@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all stations (no passwords returned)' })
  findAll() {
    return this.stationsService.findAll();
  }

  @Get('names')
  @ApiOperation({ summary: 'List active station names only' })
  findNames() {
    return this.stationsService.findNames();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single station' })
  @ApiParam({ name: 'id', type: Number })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.stationsService.findOne(id);
  }

  /**
   * Seed endpoint — protected by X-Admin-Key.
   * Call from server: curl -X POST -H "X-Admin-Key: <ADMIN_PASSWORD>" /api/stations/seed-demo
   */
  @Post('seed-demo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminKeyGuard)
  @ApiOperation({ summary: 'Seed all Indongozi SACCO branches (X-Admin-Key required)' })
  @ApiHeader({ name: 'X-Admin-Key', description: 'Must match ADMIN_PASSWORD', required: true })
  @ApiResponse({ status: 200, description: 'Created and skipped branch names' })
  @ApiResponse({ status: 401, description: 'Missing or invalid X-Admin-Key' })
  seedDemo() {
    return this.stationsService.seedDemoStations();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new station' })
  @ApiResponse({ status: 201, description: 'Created station' })
  @ApiResponse({ status: 409, description: 'Station name already exists' })
  create(@Body() dto: CreateStationDto) {
    return this.stationsService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a station' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateStationDto>,
  ) {
    return this.stationsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a station' })
  @ApiParam({ name: 'id', type: Number })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.stationsService.remove(id);
  }
}
