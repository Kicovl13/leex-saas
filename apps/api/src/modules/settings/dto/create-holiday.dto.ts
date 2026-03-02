import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}
