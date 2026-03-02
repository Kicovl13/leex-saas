import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';

export class CreateTimeEntryDto {
  @IsString()
  matterId!: string;

  @IsOptional()
  @IsString()
  userId?: string; // Si no se envía, se usa el usuario del token

  @IsString()
  description!: string;

  @IsInt()
  @Min(1)
  minutes!: number;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  rateCents?: number;

  @IsOptional()
  @IsString()
  activityType?: string; // litigio | asesoria | reunion | documentacion | otro

  @IsDateString()
  date!: string;
}
