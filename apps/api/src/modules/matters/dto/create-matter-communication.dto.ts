import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMatterCommunicationDto {
  @IsString()
  @MaxLength(50)
  type!: string; // email | call | meeting

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsDateString()
  occurredAt!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
