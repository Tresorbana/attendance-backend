import {
  IsString,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnrollDto {
  @ApiProperty({ description: 'Full name of the person', example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description: 'Role of the person',
    example: 'Student',
    default: 'Student',
  })
  @IsString()
  @IsOptional()
  role: string = 'Student';

  @ApiProperty({
    description: '128-dimensional face descriptor array from face-api.js',
    type: [Number],
    minItems: 128,
    maxItems: 512,
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(128)
  @ArrayMaxSize(512)
  descriptor: number[];
}
