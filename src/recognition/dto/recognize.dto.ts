import { IsArray, IsNumber, IsOptional, ArrayMinSize, ArrayMaxSize, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecognizeDto {
  @ApiProperty({
    description: '128-dimensional face descriptor produced by face-api.js',
    type: [Number],
    minItems: 128,
    maxItems: 512,
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(128)
  @ArrayMaxSize(512)
  descriptor: number[];

  @ApiPropertyOptional({
    description: 'Average frame brightness 0–255 from the browser preprocessor. Used to relax the recognition threshold in poor lighting.',
    minimum: 0,
    maximum: 255,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(255)
  brightness?: number;
}
