import { Controller, Post, Body, HttpCode, HttpStatus, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RecognitionService } from './recognition.service';
import { RecognizeDto } from './dto/recognize.dto';
import { FingerprintGateway } from '../fingerprint/fingerprint.gateway';
import { PythonPipelineService } from '../fingerprint/python-pipeline.service';
import { isPngBase64 } from '../shared/image-utils';

@ApiTags('recognition')
@Controller()
export class RecognitionController {
  constructor(
    private readonly recognitionService: RecognitionService,
    private readonly gateway: FingerprintGateway,
    private readonly pythonPipeline: PythonPipelineService,
  ) {}

  @Post('recognize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Match a fingerprint PNG against enrolled employees via Python pipeline' })
  @ApiResponse({
    status: 200,
    description: '{ matched: true, name, score, person_id, action } or { matched: false, error? }',
  })
  async recognize(@Body() dto: RecognizeDto) {
    if (!isPngBase64(dto.template)) {
      return { matched: false, error: 'Python pipeline requires a PNG base64 image' };
    }

    if (!this.pythonPipeline.isEnabled()) {
      return { matched: false, error: 'pipeline_unavailable' };
    }

    const pyResult = await this.pythonPipeline.identify(dto.template);
    if (!pyResult) {
      return { matched: false, error: 'pipeline_unavailable' };
    }

    if (!pyResult.matched || !pyResult.person_id) {
      return { matched: false, flag: pyResult.flag, pipeline: 'python' };
    }

    const personId = parseInt(pyResult.person_id, 10);
    if (isNaN(personId)) {
      return { matched: false, error: 'invalid_person_id' };
    }

    const result = await this.recognitionService.recordAttendanceByPersonId(
      personId,
      pyResult.confidence_score,
    );
    this.gateway.broadcastAttendance({ ...result, pipeline: 'python' });
    return { ...result, pipeline: 'python' };
  }

  @Post('scan-quality')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check fingerprint scan quality via Python pipeline' })
  @ApiResponse({ status: 200, description: '{ acceptable, clarity_score, coverage, reason }' })
  async scanQuality(@Body() body: { image: string }) {
    if (!body?.image) return { acceptable: false, error: 'no_image' };
    const result = await this.pythonPipeline.scanQuality(body.image);
    return result ?? { acceptable: false, clarity_score: 0, coverage: 0, reason: 'pipeline_unavailable', error: 'pipeline_unavailable' };
  }

  @Post('coverage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit an enrollment scan to the coverage session and get updated progress.',
    description: 'Returns per-cell coverage grid + completion flags so the UI can animate ' +
      'the fingerprint outline and stop only when the full print pattern is captured.',
  })
  async coverage(@Body() body: { sessionId: string; image: string }) {
    if (!body?.sessionId || !body?.image) {
      return { accepted: false, error: 'missing_fields' };
    }
    const result = await this.pythonPipeline.coverage(body.sessionId, body.image);
    return result ?? {
      accepted: false, reason: 'pipeline_unavailable', error: 'pipeline_unavailable',
      clarity_score: 0, coverage: 0, minutiae_count: 0, new_cells_covered: 0, state: null,
    };
  }

  @Post('coverage/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a coverage session' })
  async coverageReset(@Body() body: { sessionId: string }) {
    if (!body?.sessionId) return { ok: false };
    await this.pythonPipeline.resetCoverage(body.sessionId);
    return { ok: true };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'ok' };
  }
}
