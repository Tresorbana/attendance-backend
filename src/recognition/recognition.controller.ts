import { Controller, Post, Body, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RecognitionService } from './recognition.service';
import { RecognizeDto } from './dto/recognize.dto';

@ApiTags('recognition')
@Controller()
export class RecognitionController {
  constructor(private readonly recognitionService: RecognitionService) {}

  @Post('recognize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recognize a face from its 128D descriptor' })
  @ApiResponse({
    status: 200,
    description:
      '{ matched: true, name, confidence, person_id } or { matched: false }',
  })
  @ApiResponse({ status: 400, description: 'Invalid descriptor array' })
  recognize(@Body() dto: RecognizeDto) {
    return this.recognitionService.recognize(dto.descriptor, dto.brightness);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: '{ status: "ok" }' })
  health() {
    return { status: 'ok' };
  }
}
