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
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { PeopleService } from './people.service';
import { EnrollDto } from './dto/enroll.dto';
import { PythonPipelineService } from '../fingerprint/python-pipeline.service';

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
  @ApiOperation({ summary: 'Update employee details (no fingerprint re-enroll)' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<Omit<EnrollDto, 'fingerprintTemplate'>>,
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
  private readonly logger = new Logger(EnrollController.name);

  constructor(
    private readonly peopleService: PeopleService,
    private readonly pythonPipeline: PythonPipelineService,
  ) {}

  @Post('enroll/check-duplicate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if an employee would be a duplicate before enrolling',
    description: 'Returns isDuplicate=true with reason and existing person if a match is found by employeeId or name+station.',
  })
  @ApiResponse({ status: 200, description: '{ isDuplicate, reason?, existingPerson? }' })
  checkDuplicate(@Body() dto: EnrollDto) {
    return this.peopleService.checkDuplicate(dto);
  }

  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enroll a new person with fingerprint template' })
  @ApiResponse({ status: 201, description: '{ id, name, pythonEnroll? }' })
  @ApiResponse({ status: 409, description: 'Duplicate employee (by ID or name)' })
  async enroll(@Body() dto: EnrollDto) {
    // 1. Create person and store TS minutiae template (existing path)
    const person = await this.peopleService.enroll(dto);

    // 2. If Python pipeline enabled, also enroll in the Python service.
    //    Use fingerprintTemplates (multi-scan) when provided, else wrap single image.
    if (this.pythonPipeline.isEnabled()) {
      const images: string[] = dto.fingerprintTemplates?.length
        ? dto.fingerprintTemplates
        : dto.fingerprintTemplate && dto.fingerprintTemplate !== 'pending'
          ? [dto.fingerprintTemplate]
          : [];

      if (images.length >= 1) {
        const pyResult = await this.pythonPipeline.enroll(String(person.id), images);
        if (pyResult) {
          this.logger.log(
            `Python enroll person_id=${person.id}: stored=${pyResult.template_stored} ` +
            `steps=${pyResult.steps_applied?.join(',')} error=${pyResult.error ?? 'none'}`,
          );
          return { ...person, pythonEnroll: pyResult };
        }
      }
    }

    return person;
  }
}
