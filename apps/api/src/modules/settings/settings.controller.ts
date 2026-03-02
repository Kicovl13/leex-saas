import {
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Body,
  Delete,
  Param,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { ActivityTypesService } from './activity-types.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateAppearanceDto } from './dto/update-appearance.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { SetActivityTypesDto } from './dto/set-activity-types.dto';
import { UserId } from '../../common/decorators/user-id.decorator';

@ApiTags('Configuración')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(TenantGuard)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly activityTypes: ActivityTypesService,
  ) {}

  @Get()
  getPlanAndUsage(@OrganizationId() organizationId: string) {
    return this.settings.getPlanAndUsage(organizationId);
  }

  @Get('appearance')
  getAppearance(@OrganizationId() organizationId: string) {
    return this.settings.getAppearance(organizationId);
  }

  @Get('profile')
  getProfile(@OrganizationId() organizationId: string) {
    return this.settings.getProfile(organizationId);
  }

  @Patch('profile')
  updateProfile(
    @OrganizationId() organizationId: string,
    @Body() body: UpdateProfileDto,
  ) {
    return this.settings.updateProfile(organizationId, {
      address: body.address,
      phone: body.phone,
      website: body.website,
      currency: body.currency,
    });
  }

  @Get('holidays')
  getHolidays(@OrganizationId() organizationId: string) {
    return this.settings.getHolidays(organizationId);
  }

  @Post('holidays')
  createHoliday(
    @OrganizationId() organizationId: string,
    @Body() body: CreateHolidayDto,
  ) {
    return this.settings.createHoliday(organizationId, {
      date: body.date,
      name: body.name,
    });
  }

  @Delete('holidays/:id')
  removeHoliday(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
  ) {
    return this.settings.removeHoliday(organizationId, id);
  }

  @Get('logo-url')
  async getLogoUrl(@OrganizationId() organizationId: string) {
    const result = await this.settings.getLogoUrl(organizationId);
    if (!result) return { url: null };
    return result;
  }

  @Post('logo-upload-url')
  getLogoUploadUrl(
    @OrganizationId() organizationId: string,
    @Body() body: { contentType?: string },
  ) {
    return this.settings.getLogoUploadUrl(
      organizationId,
      body.contentType ?? 'image/png',
    );
  }

  @Post('invitations')
  createInvitation(
    @OrganizationId() organizationId: string,
    @UserId() userId: string | undefined,
    @Body() body: InviteMemberDto,
  ) {
    if (!userId) throw new ForbiddenException('Debe iniciar sesión para invitar.');
    return this.settings.createInvitation(organizationId, userId, body.email);
  }

  @Patch('appearance')
  updateAppearance(
    @OrganizationId() organizationId: string,
    @Body() body: UpdateAppearanceDto,
  ) {
    return this.settings.updateAppearance(organizationId, {
      logoUrl: body.logoUrl,
      primaryColor: body.primaryColor,
      darkMode: body.darkMode,
      fontFamily: body.fontFamily,
      themePreference: body.themePreference,
    });
  }

  @Get('activity-types')
  getActivityTypes(@OrganizationId() organizationId: string) {
    return this.activityTypes.list(organizationId);
  }

  @Put('activity-types')
  setActivityTypes(
    @OrganizationId() organizationId: string,
    @Body() body: SetActivityTypesDto,
  ) {
    return this.activityTypes.setTypes(organizationId, body.types);
  }
}
