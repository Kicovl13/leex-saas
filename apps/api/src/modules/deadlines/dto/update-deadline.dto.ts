import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateDeadlineDto } from './create-deadline.dto';

export class UpdateDeadlineDto extends PartialType(CreateDeadlineDto) {
  @IsOptional()
  @IsDateString()
  completedAt?: string | null;
}
