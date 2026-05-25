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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { StationsService } from './stations.service';
import { CreateStationDto } from './dto/create-station.dto';

@ApiTags('stations')
@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all stations with admin info (no passwords)' })
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

  @Post('seed-demo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Seed demo stations with portal credentials for testing',
    description: 'Creates 3 demo stations if they do not already exist. Safe to call multiple times.',
  })
  @ApiResponse({ status: 200, description: 'Array of created/existing demo stations' })
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
