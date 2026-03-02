import { IsBoolean, IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { MatterActivityType } from '../../../generated/prisma';

export class CreateActivityDto {
  @IsEnum(MatterActivityType)
  type!: MatterActivityType;

  @IsString()
  content!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
