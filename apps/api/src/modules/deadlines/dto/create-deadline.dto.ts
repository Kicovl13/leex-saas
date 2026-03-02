import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { DeadlineType } from '../../../generated/prisma';

export class CreateDeadlineDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsEnum(DeadlineType)
  deadlineType?: DeadlineType;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  matterId!: string;
}
