import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAppearanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  primaryColor?: string;

  @IsOptional()
  @IsBoolean()
  darkMode?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fontFamily?: string;

  /** light | dark | system — para next-themes */
  @IsOptional()
  @IsString()
  themePreference?: 'light' | 'dark' | 'system';
}
