import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';

@ApiTags('Búsqueda')
@ApiBearerAuth()
@Controller('search')
@UseGuards(TenantGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  globalSearch(
    @OrganizationId() organizationId: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
  ) {
    const term = (q ?? '').trim();
    const limit = Math.min(Math.max(1, parseInt(take ?? '5', 10)), 10);
    return this.search.globalSearch(organizationId, term, limit);
  }
}
