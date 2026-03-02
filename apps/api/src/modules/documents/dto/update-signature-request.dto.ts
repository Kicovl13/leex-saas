import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSignatureRequestDto {
  @IsString()
  @IsIn(['pending', 'sent', 'signed', 'failed', 'cancelled'])
  status!: 'pending' | 'sent' | 'signed' | 'failed' | 'cancelled';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceUrl?: string;
}
