import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class AiCallbackDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  organizationId!: string;

  @IsString()
  @IsIn(['completed', 'failed'])
  status!: 'completed' | 'failed';

  @IsObject()
  aiMetadata!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
