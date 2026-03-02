import { IsEnum, IsNumber, IsOptional, IsString, IsObject, MaxLength, ValidateIf } from 'class-validator';
import { MatterStatus } from '../../../generated/prisma';

export class UpdateMatterDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  stage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  matterType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceCode?: string;

  @IsOptional()
  @IsString()
  responsibleUserId?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v != null)
  @IsNumber()
  amount?: number | null;

  @IsOptional()
  @ValidateIf((_o, v) => v != null)
  @IsNumber()
  hourlyRateCents?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  courtName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fileNumber?: string | null;

  @IsOptional()
  @ValidateIf((_o, v) => v != null)
  @IsNumber()
  budgetHours?: number | null;

  /** Campos específicos por matterType (ej. CORPORATE: meetingDate, parties; CONTRACTS: parties, effectiveDate) */
  @IsOptional()
  @ValidateIf((_o, v) => v != null)
  @IsObject()
  customFields?: Record<string, unknown> | null;
}
