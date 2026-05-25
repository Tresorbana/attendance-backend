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
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PeopleService } from './people.service';
import { EnrollDto } from './dto/enroll.dto';

@ApiTags('people')
@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  @ApiOperation({ summary: 'List all enrolled people (without face descriptors)' })
  @ApiQuery({ name: 'station', required: false, type: String, description: 'Filter by station' })
  findAll(@Query('station') station?: string) {
    return this.peopleService.findAll(station);
  }

  @Get('stations')
  @ApiOperation({ summary: 'List distinct station/branch names' })
  getStations() {
    return this.peopleService.getStations();
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update employee details (no face re-enroll)' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<Omit<EnrollDto, 'descriptor'>>,
  ) {
    return this.peopleService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an enrolled person' })
  @ApiParam({ name: 'id', type: Number })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.peopleService.remove(id);
  }
}

@ApiTags('people')
@Controller()
export class EnrollController {
  constructor(private readonly peopleService: PeopleService) {}

  @Post('enroll/check-duplicate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if an employee would be a duplicate before enrolling',
    description: 'Returns isDuplicate=true with reason and existing person if a match is found by employeeId, face, or name+station.',
  })
  @ApiResponse({ status: 200, description: '{ isDuplicate, reason?, existingPerson?, faceDistance? }' })
  checkDuplicate(@Body() dto: EnrollDto) {
    return this.peopleService.checkDuplicate(dto);
  }

  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a new person with face descriptor' })
  @ApiResponse({ status: 201, description: '{ id, name }' })
  @ApiResponse({ status: 409, description: 'Duplicate employee (by ID, face, or name)' })
  enroll(@Body() dto: EnrollDto) {
    return this.peopleService.enroll(dto);
  }
}
