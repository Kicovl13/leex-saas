import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ReplaceDocumentDto {
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  folder?: string;
}
