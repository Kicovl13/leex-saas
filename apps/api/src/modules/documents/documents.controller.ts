import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
  Delete,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { UserId } from '../../common/decorators/user-id.decorator';
import { UserRole } from '../../common/decorators/user-role.decorator';
import { UploadUrlDto } from './dto/upload-url.dto';
import { DocumentsQueryDto } from './dto/documents-query.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { ReplaceDocumentDto } from './dto/replace-document.dto';
import { AddDocumentTagDto } from './dto/add-document-tag.dto';
import { RejectVersionDto } from './dto/reject-version.dto';
import { CreateShareLinkDto } from './dto/create-share-link.dto';
import { CreateSignatureRequestDto } from './dto/create-signature-request.dto';
import { UpdateSignatureRequestDto } from './dto/update-signature-request.dto';
import { ReanalyzeDto } from './dto/reanalyze.dto';
import { UpsertRetentionPolicyDto } from './dto/upsert-retention-policy.dto';
import type { UserRole as UserRoleEnum } from '../../generated/prisma';

@Controller('documents')
@UseGuards(TenantGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload-url')
  async getUploadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Body() body: UploadUrlDto,
  ) {
    return this.documents.getUploadUrl(organizationId, {
      matterId: body.matterId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      folder: body.folder,
    }, userId);
  }

  @Get()
  async findByMatter(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Query() query: DocumentsQueryDto,
  ) {
    return this.documents.findByMatter(organizationId, {
      userId,
      userRole,
      matterId: query.matterId,
      name: query.name,
      mimeType: query.mimeType,
      folder: query.folder,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      q: query.q,
      tag: query.tag,
      classification: query.classification,
    });
  }

  @Get('trash')
  async listTrash(
    @OrganizationId() organizationId: string,
    @Query('matterId') matterId?: string,
  ) {
    return this.documents.listTrash(organizationId, matterId);
  }

  @Post('retention/policies')
  async upsertRetentionPolicy(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Body() body: UpsertRetentionPolicyDto,
  ) {
    return this.documents.upsertRetentionPolicy(organizationId, body, userRole);
  }

  @Get('retention/policies')
  async listRetentionPolicies(
    @OrganizationId() organizationId: string,
  ) {
    return this.documents.listRetentionPolicies(organizationId);
  }

  @Post('retention/sweep')
  async runRetentionSweep(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
  ) {
    return this.documents.runRetentionSweep(organizationId, userRole);
  }

  @Post(':id/confirm')
  async confirmUpload(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.documents.confirmUpload(organizationId, id);
  }

  @Post(':id/reanalyze')
  async reanalyze(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: ReanalyzeDto,
  ) {
    return this.documents.reanalyze(organizationId, id, body.taskType);
  }

  @Get(':id')
  async findOne(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.findOne(organizationId, id, userId, userRole);
  }

  @Get(':id/read-url')
  async getReadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.getReadUrl(organizationId, id, userId, userRole);
  }

  @Get(':id/download-url')
  async getDownloadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.getDownloadUrl(organizationId, id, userId, userRole);
  }

  @Get(':id/share-url')
  async getShareUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.getReadUrl(organizationId, id, userId, userRole);
  }

  @Patch(':id')
  async updateMetadata(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Body() body: UpdateDocumentDto,
  ) {
    return this.documents.updateDocumentMetadata(organizationId, id, body, userRole);
  }

  @Post(':id/versions/upload-url')
  async getVersionUploadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Body() body: ReplaceDocumentDto,
  ) {
    return this.documents.createVersionUploadUrl(organizationId, id, body, userId, userRole);
  }

  @Get(':id/versions')
  async listVersions(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.listVersions(organizationId, id, userId, userRole);
  }

  @Get(':id/versions/:versionId/read-url')
  async getVersionReadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documents.getVersionReadUrl(organizationId, id, versionId, userId, userRole);
  }

  @Get(':id/versions/:versionId/download-url')
  async getVersionDownloadUrl(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documents.getVersionDownloadUrl(organizationId, id, versionId, userId, userRole);
  }

  @Post(':id/versions/:versionId/restore')
  async restoreVersion(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documents.restoreVersion(organizationId, id, versionId, userId, userRole);
  }

  @Post(':id/tags')
  async addTag(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Body() body: AddDocumentTagDto,
  ) {
    return this.documents.addTag(organizationId, id, body, userRole);
  }

  @Get(':id/tags')
  async listTags(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.listTags(organizationId, id, userId, userRole);
  }

  @Delete(':id/tags/:tagLabel')
  async removeTag(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('tagLabel') tagLabel: string,
  ) {
    return this.documents.removeTag(organizationId, id, tagLabel, userRole);
  }

  @Post(':id/versions/:versionId/request-review')
  async requestVersionReview(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documents.requestVersionReview(organizationId, id, versionId, userId, userRole);
  }

  @Post(':id/versions/:versionId/approve')
  async approveVersion(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.documents.approveVersion(organizationId, id, versionId, userId, userRole);
  }

  @Post(':id/versions/:versionId/reject')
  async rejectVersion(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() body: RejectVersionDto,
  ) {
    return this.documents.rejectVersion(organizationId, id, versionId, body.reason, userId, userRole);
  }

  @Get(':id/versions/compare')
  async compareVersions(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Query('fromVersionId') fromVersionId: string,
    @Query('toVersionId') toVersionId: string,
  ) {
    return this.documents.compareVersions(
      organizationId,
      id,
      fromVersionId,
      toVersionId,
      userId,
      userRole,
    );
  }

  @Get(':id/timeline')
  async getTimeline(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.getTimeline(organizationId, id, userId, userRole);
  }

  @Post(':id/share-links')
  async createShareLink(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Body() body: CreateShareLinkDto,
  ) {
    return this.documents.createShareLink(organizationId, id, body, userId, userRole);
  }

  @Get(':id/share-links')
  async listShareLinks(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.listShareLinks(organizationId, id, userId, userRole);
  }

  @Post(':id/share-links/:shareLinkId/revoke')
  async revokeShareLink(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('shareLinkId') shareLinkId: string,
  ) {
    return this.documents.revokeShareLink(organizationId, id, shareLinkId, userRole);
  }

  @Post(':id/signature-requests')
  async createSignatureRequest(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Body() body: CreateSignatureRequestDto,
  ) {
    return this.documents.createSignatureRequest(organizationId, id, body, userId, userRole);
  }

  @Get(':id/signature-requests')
  async listSignatureRequests(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.listSignatureRequests(organizationId, id, userId, userRole);
  }

  @Patch(':id/signature-requests/:requestId')
  async updateSignatureRequest(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() body: UpdateSignatureRequestDto,
  ) {
    return this.documents.updateSignatureRequest(organizationId, id, requestId, body, userRole);
  }


  @Delete(':id')
  async moveToTrash(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.moveToTrash(organizationId, id, userId, userRole);
  }

  @Post(':id/restore')
  async restoreFromTrash(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.restoreFromTrash(organizationId, id, userRole);
  }

  @Delete(':id/hard')
  async hardDelete(
    @OrganizationId() organizationId: string,
    @UserRole() userRole: UserRoleEnum | undefined,
    @Param('id') id: string,
  ) {
    return this.documents.hardDelete(organizationId, id, userRole);
  }
}
