import { IsString } from 'class-validator';

export class RecomputeMetricsDto {
  @IsString()
  organizationId!: string;
}
