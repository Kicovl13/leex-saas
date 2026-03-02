import { IsString } from 'class-validator';

export class GenerateTemplateDto {
  @IsString()
  matterId: string;
}
