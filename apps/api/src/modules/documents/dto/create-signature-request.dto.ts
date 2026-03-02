import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSignatureRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  provider?: string;

  @IsOptional()
  @IsArray()
  signers?: Array<{ name?: string; email: string }>;
}
