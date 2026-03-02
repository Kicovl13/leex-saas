import { PartialType } from '@nestjs/mapped-types';
import { CreateDeadlineRuleDto } from './create-deadline-rule.dto';

export class UpdateDeadlineRuleDto extends PartialType(CreateDeadlineRuleDto) {}
