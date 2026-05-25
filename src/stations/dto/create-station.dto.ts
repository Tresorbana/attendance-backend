import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStationDto {
  @ApiProperty({ example: 'Bushenge Branch' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ example: 'BSG' })
  @IsString()
  @IsOptional()
  @MaxLength(30)
  code?: string;

  @ApiPropertyOptional({ example: 'Bushenge, Nyamasheke District' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 'bsg_admin' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  adminUsername?: string;

  @ApiPropertyOptional({ example: 'SecurePass@2026' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  adminPassword?: string;

  @ApiPropertyOptional({ example: 'Bushenge Branch Admin' })
  @IsString()
  @IsOptional()
  @MaxLength(150)
  adminFullName?: string;
}
