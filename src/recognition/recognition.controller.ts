import { Controller, Post, Body, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RecognitionService } from './recognition.service';
import { RecognizeDto } from './dto/recognize.dto';
import { FingerprintGateway } from '../fingerprint/fingerprint.gateway';

@ApiTags('recognition')
@Controller()
export class RecognitionController {
  constructor(
    private readonly recognitionService: RecognitionService,
    private readonly gateway: FingerprintGateway,
  ) {}

  @Post('recognize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Match a fingerprint template against enrolled employees' })
  @ApiResponse({
    status: 200,
    description:
      '{ matched: true, name, score, person_id, action } or { matched: false }',
  })
  async recognize(@Body() dto: RecognizeDto) {
    const result = await this.recognitionService.recognize(dto.template);
    this.gateway.broadcastAttendance(result);
    return result;
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'ok' };
  }
}
