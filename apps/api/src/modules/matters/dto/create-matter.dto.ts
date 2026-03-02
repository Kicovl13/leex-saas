import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { MatterStatus } from '../../../generated/prisma';

export class CreateMatterDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(MatterStatus)
  status?: MatterStatus;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  matterType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  referenceCode?: string;

  @IsOptional()
  @IsDateString()
  openedAt?: string;

  @IsString()
  clientId!: string;

  /** Abogado responsable (User.id de la organización) */
  @IsOptional()
  @IsString()
  responsibleUserId?: string;

  /** Nombre de la contraparte para conflict check (aviso si coincide con un cliente) */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  contraparteNombre?: string;

  /** Si hay conflicto, enviar true para crear igual tras aviso */
  @IsOptional()
  @IsBoolean()
  forceCreate?: boolean;
}
