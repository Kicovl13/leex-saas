import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateDeadlineRuleDto {
  @IsString()
  @MaxLength(120)
  courtType!: string;

  @IsString()
  @MaxLength(255)
  legalBasis!: string;

  @IsInt()
  @Min(0)
  defaultDays!: number;

  @IsOptional()
  @IsBoolean()
  isBusinessDays?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jurisdiction?: string;
}
