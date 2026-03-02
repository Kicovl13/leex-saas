import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
