import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateShareLinkDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 30)
  expiresInMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxUses?: number;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  watermarkText?: string;
}
