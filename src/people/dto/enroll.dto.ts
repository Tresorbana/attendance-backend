import {
  IsString,
  IsArray,
  IsNumber,
  ArrayMinSize,
  ArrayMaxSize,
  IsNotEmpty,
  IsOptional,
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

  @ApiPropertyOptional({
    description: 'Role of the person',
    example: 'Employee',
    default: 'Employee',
  })
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
