import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecognizeDto {
  @ApiProperty({
    description: 'Base64-encoded SourceAFIS fingerprint template',
  })
  @IsString()
  @IsNotEmpty()
  template: string;
}
