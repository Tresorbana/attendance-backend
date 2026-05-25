import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStationDto {
  @ApiProperty({ example: 'Nairobi HQ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'NBI-HQ' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional({ example: 'Upperhill, Nairobi' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 'nairobi_admin' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  adminUsername?: string;

  @ApiPropertyOptional({ example: 'SecurePass123' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  adminPassword?: string;

  @ApiPropertyOptional({ example: 'Nairobi Branch Admin' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  adminFullName?: string;
}
