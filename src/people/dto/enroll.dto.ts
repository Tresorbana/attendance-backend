import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ArrayMinSize,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EnrollDto {
  @ApiPropertyOptional({ description: 'Employee ID (unique)', example: 'EMP-001' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiProperty({ description: 'Full name of the person', example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Role of the person', example: 'Employee', default: 'Employee' })
  @IsString()
  @IsOptional()
  role: string = 'Employee';

  @ApiPropertyOptional({ description: 'Office station / branch', example: 'Bushenge Branch' })
  @IsString()
  @IsOptional()
  station?: string;

  @ApiPropertyOptional({ description: 'Expected check-in time HH:MM', example: '08:00' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'scheduleStart must be HH:MM' })
  scheduleStart?: string;

  @ApiPropertyOptional({ description: 'Expected check-out time HH:MM', example: '17:00' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'scheduleEnd must be HH:MM' })
  scheduleEnd?: string;

  @ApiPropertyOptional({
    description: 'Multiple fingerprint scans (recommended — array of base64 PNG strings, min 2). Takes precedence over fingerprintTemplate when provided.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2)
  @IsOptional()
  fingerprintTemplates?: string[];

  @ApiProperty({
    description: 'Single fingerprint scan (base64 PNG or pre-processed minutiae JSON). Ignored when fingerprintTemplates is provided.',
  })
  @IsString()
  @IsNotEmpty()
  fingerprintTemplate: string;
}
