import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { TimeEntriesService } from './time-entries.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('../../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('TimeEntriesService', () => {
  let service: TimeEntriesService;
  let prisma: {
    timeEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      aggregate: jest.Mock;
    };
  };

  const orgId = 'org-1';
  const userA = 'user-a';
  const userB = 'user-b';
  const entryId = 'entry-1';

  beforeEach(async () => {
    prisma = {
      timeEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirstOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        aggregate: jest.fn(),
      },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeEntriesService,
        {
          provide: PrismaService,
          useValue: { timeEntry: prisma.timeEntry },
        },
      ],
    }).compile();
    service = module.get<TimeEntriesService>(TimeEntriesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('filters by restrictToUserId when provided', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findAll(orgId, { restrictToUserId: userA });
      expect(prisma.timeEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: orgId, userId: userA }),
        }),
      );
    });
    it('does not add userId when restrictToUserId is undefined', async () => {
      prisma.timeEntry.findMany.mockResolvedValue([]);
      await service.findAll(orgId);
      const call = prisma.timeEntry.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ organizationId: orgId });
    });
  });

  describe('findOne', () => {
    it('throws ForbiddenException when requireOwnershipUserId does not match entry userId', async () => {
      prisma.timeEntry.findFirstOrThrow.mockResolvedValue({
        id: entryId,
        userId: userB,
        organizationId: orgId,
      });
      await expect(
        service.findOne(orgId, entryId, userA),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.findOne(orgId, entryId, userA),
      ).rejects.toThrow('No tiene permiso para ver este registro de tiempo');
    });
    it('returns entry when requireOwnershipUserId matches', async () => {
      const entry = { id: entryId, userId: userA, organizationId: orgId };
      prisma.timeEntry.findFirstOrThrow.mockResolvedValue(entry);
      const result = await service.findOne(orgId, entryId, userA);
      expect(result).toEqual(entry);
    });
  });

  describe('update', () => {
    it('throws ForbiddenException when requireOwnershipUserId does not match entry userId', async () => {
      prisma.timeEntry.findFirstOrThrow.mockResolvedValue({
        id: entryId,
        userId: userB,
        organizationId: orgId,
      });
      await expect(
        service.update(orgId, entryId, { minutes: 60 }, userA),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.update(orgId, entryId, { minutes: 60 }, userA),
      ).rejects.toThrow('No tiene permiso para modificar');
      expect(prisma.timeEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws ForbiddenException when requireOwnershipUserId does not match entry userId', async () => {
      prisma.timeEntry.findFirstOrThrow.mockResolvedValue({
        id: entryId,
        userId: userB,
        organizationId: orgId,
      });
      await expect(
        service.remove(orgId, entryId, userA),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.remove(orgId, entryId, userA),
      ).rejects.toThrow('No tiene permiso para eliminar');
      expect(prisma.timeEntry.delete).not.toHaveBeenCalled();
    });
  });
});
