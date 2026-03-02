import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class AiResultsDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  classification?: string;

  @IsOptional()
  @IsString()
  riskLevel?: string;

  /** Resto del resultado de la IA (parties, deadlines, etc.) */
  @IsOptional()
  @IsObject()
  aiMetadata?: Record<string, unknown>;
}
