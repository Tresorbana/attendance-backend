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
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PeopleService } from './people.service';
import { EnrollDto } from './dto/enroll.dto';

@ApiTags('people')
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  @ApiOperation({ summary: 'List all enrolled people (without face descriptors)' })
  @ApiResponse({ status: 200, description: 'Array of person objects' })
  findAll() {
    return this.peopleService.findAll();
  }

  @Get('stations')
  @ApiOperation({ summary: 'List distinct station/branch names' })
  @ApiResponse({ status: 200, description: 'Array of station name strings' })
  getStations() {
    return this.peopleService.getStations();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details (no face re-enroll)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Updated person object' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<Omit<EnrollDto, 'descriptor'>>,
  ) {
    return this.peopleService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an enrolled person' })
  @ApiParam({ name: 'id', type: Number, description: 'Person ID' })
  @ApiResponse({ status: 204, description: 'Person deleted' })
  @ApiResponse({ status: 404, description: 'Person not found' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.peopleService.remove(id);
  }
}

/**
 * Top-level controller — handles the routes the frontend calls
 * without a sub-path prefix (enroll, stats).
 */
@ApiTags('people')
@Controller()
export class EnrollController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a new person with face descriptor' })
  @ApiResponse({ status: 201, description: '{ id, name }' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  enroll(@Body() dto: EnrollDto) {
    return this.peopleService.enroll(dto);
  }
}
