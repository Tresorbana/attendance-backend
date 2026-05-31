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
  @ApiOperation({ summary: 'Match a fingerprint template against enrolled employees' })
  @ApiResponse({
    status: 200,
    description:
      '{ matched: true, name, score, person_id, action } or { matched: false }',
  })
  recognize(@Body() dto: RecognizeDto) {
    return this.recognitionService.recognize(dto.template);
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'ok' };
  }
}
