import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpsertRetentionPolicyDto {
  @IsString()
  @MaxLength(64)
  documentType!: string;

  @IsInt()
  @Min(1)
  @Max(36500)
  retentionDays!: number;

  @IsOptional()
  @IsBoolean()
  autoHardDelete?: boolean;
}
