import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TaskStatus } from '../../../generated/prisma';

export class CreateTaskDto {
  @IsString()
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  matterId?: string | null;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
