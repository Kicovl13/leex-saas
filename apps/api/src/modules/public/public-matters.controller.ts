import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UseInterceptors } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { NotFoundException } from '@nestjs/common';

@Controller('public/matters')
@UseGuards(ThrottlerGuard)
export class PublicMattersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  /**
   * Vista pública del expediente (sin auth). Solo estado y actuaciones públicas.
   * Rate limit: 30 peticiones por minuto por IP.
   */
  @Get(':token')
  async findByToken(@Param('token') token: string) {
    const matter = await this.prisma.raw.matter.findFirst({
      where: { publicToken: token },
      select: {
        id: true,
        name: true,
        status: true,
        stage: true,
        referenceCode: true,
        customFields: true,
        client: { select: { name: true } },
      },
    });
    if (!matter) throw new NotFoundException('Expediente no encontrado o enlace no válido.');

    const activities = await this.prisma.raw.matterActivity.findMany({
      where: { matterId: matter.id, isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return {
      ...matter,
      activities,
    };
  }

  /** Archivo subido por multer (evita depender de @types/multer). */
  @Post(':token/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('token') token: string,
    @UploadedFile() file: { buffer: Buffer; originalname?: string; mimetype?: string; size?: number } | undefined,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('Falta el archivo.');
    }
    return this.documents.uploadByMatterToken(token, {
      buffer: file.buffer,
      originalname: file.originalname ?? 'documento',
      mimetype: file.mimetype ?? 'application/octet-stream',
      size: file.size ?? file.buffer.length,
    });
  }
}
