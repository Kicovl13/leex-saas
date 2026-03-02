import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TemplatesService } from './templates.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { GenerateTemplateDto } from './dto';

/** Archivo subido por multer (evita depender de @types/multer). */
export interface MulterFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('templates')
@UseGuards(TenantGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @OrganizationId() organizationId: string,
    @UploadedFile() file: MulterFile | undefined,
    @Body('name') name?: string,
    @Body('description') description?: string,
    @Body('matterType') matterType?: string,
  ) {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new BadRequestException('Falta el archivo .docx');
    return this.templates.upload(
      organizationId,
      file,
      typeof name === 'string' ? name : file.originalname,
      typeof description === 'string' ? description : undefined,
      matterType,
    );
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Query('matterType') matterType?: string,
  ) {
    return this.templates.findAll(organizationId, matterType ?? undefined);
  }

  @Get(':id')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.templates.findOne(organizationId, id);
  }

  @Delete(':id')
  remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.templates.remove(organizationId, id);
  }

  @Post(':id/generate')
  async generate(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Param('id') id: string,
    @Body() body: GenerateTemplateDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.templates.generate(
      organizationId,
      id,
      body.matterId,
      userId,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.send(buffer);
  }
}
