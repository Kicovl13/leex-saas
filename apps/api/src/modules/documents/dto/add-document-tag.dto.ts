import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AddDocumentTagDto {
  @IsString()
  @MaxLength(64)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: 'manual' | 'ai';
}
