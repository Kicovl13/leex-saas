import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ClientsService } from './clients.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { OrganizationId } from '../../common/decorators/organization-id.decorator';
import { CreateClientDto, UpdateClientDto, CreateClientContactDto, UpdateClientContactDto } from './dto';

@ApiTags('Clientes')
@ApiBearerAuth()
@Controller('clients')
@UseGuards(TenantGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get(':id/contacts')
  getContacts(
    @OrganizationId() organizationId: string,
    @Param('id') clientId: string,
  ) {
    return this.clients.findContacts(organizationId, clientId);
  }

  @Post(':id/contacts')
  addContact(
    @OrganizationId() organizationId: string,
    @Param('id') clientId: string,
    @Body() body: CreateClientContactDto,
  ) {
    return this.clients.addContact(organizationId, clientId, body);
  }

  @Patch(':id/contacts/:contactId')
  updateContact(
    @OrganizationId() organizationId: string,
    @Param('id') clientId: string,
    @Param('contactId') contactId: string,
    @Body() body: UpdateClientContactDto,
  ) {
    return this.clients.updateContact(organizationId, clientId, contactId, body);
  }

  @Delete(':id/contacts/:contactId')
  removeContact(
    @OrganizationId() organizationId: string,
    @Param('id') clientId: string,
    @Param('contactId') contactId: string,
  ) {
    return this.clients.removeContact(organizationId, clientId, contactId);
  }

  @Post()
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateClientDto,
  ) {
    return this.clients.create(organizationId, body);
  }

  @Get()
  findAll(
    @OrganizationId() organizationId: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.clients.findAll(organizationId, {
      q: q?.trim(),
      take: take != null ? parseInt(take, 10) : undefined,
      skip: skip != null ? parseInt(skip, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.clients.findOne(organizationId, id);
  }

  @Patch(':id')
  update(
    @OrganizationId() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
  ) {
    return this.clients.update(organizationId, id, body);
  }

  @Delete(':id')
  remove(@OrganizationId() organizationId: string, @Param('id') id: string) {
    return this.clients.remove(organizationId, id);
  }
}
