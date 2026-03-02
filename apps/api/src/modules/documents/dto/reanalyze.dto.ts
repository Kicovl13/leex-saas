import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReanalyzeDto {
  @IsOptional()
  @IsString()
  @IsIn(['CLASSIFY', 'DEEP_ANALYSIS', 'MASSIVE_SUMMARY'])
  taskType?: 'CLASSIFY' | 'DEEP_ANALYSIS' | 'MASSIVE_SUMMARY';
}
