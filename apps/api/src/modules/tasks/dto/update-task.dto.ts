import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TaskStatus } from '../../../generated/prisma';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  assignedToId?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;
}
