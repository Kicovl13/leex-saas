import {
  IsInt,
  IsIn,
  IsObject,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class InternalAiResultDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsString()
  @IsIn(['completed', 'failed'])
  status!: 'completed' | 'failed';

  @IsObject()
  aiMetadata!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsString()
  executionId?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  attemptCount?: number;
}
