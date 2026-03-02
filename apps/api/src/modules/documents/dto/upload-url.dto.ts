import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

export class UploadUrlDto {
  @IsString()
  matterId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  folder?: string; // Pruebas | Escritos | Sentencias

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
