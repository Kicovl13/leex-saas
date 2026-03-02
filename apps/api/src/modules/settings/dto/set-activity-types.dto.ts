import { IsArray, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ActivityTypeItemDto {
  @IsString()
  @MaxLength(50)
  key!: string;

  @IsString()
  @MaxLength(100)
  label!: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class SetActivityTypesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityTypeItemDto)
  types!: ActivityTypeItemDto[];
}
