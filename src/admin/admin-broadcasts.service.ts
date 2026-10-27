import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminBroadcastCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateAdminBroadcastDto } from './dto/create-admin-broadcast.dto';

const adminBroadcastSelect = {
  id: true,
  title: true,
  body: true,
  category: true,
  forcedLive: true,
  playerCanDismiss: true,
  createdAt: true,
  createdById: true,
} as const;

type AdminBroadcastRecord = {
  id: string;
  title: string;
  body: string;
  category: AdminBroadcastCategory;
  forcedLive: boolean;
  playerCanDismiss: boolean;
  createdAt: Date;
  createdById: string | null;
};

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class AdminBroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async create(
    adminId: string,
    createAdminBroadcastDto: CreateAdminBroadcastDto,
  ) {
    const category =
      createAdminBroadcastDto.category ?? AdminBroadcastCategory.DISMISSIBLE;
    const forcedLive = category === AdminBroadcastCategory.FORCED;
    let deactivatedForcedIds: string[] = [];

    const broadcast = await this.prisma.$transaction(async (tx) => {
      if (forcedLive) {
        deactivatedForcedIds = await this.deactivateLiveForcedBroadcasts(tx);
      }

      return tx.adminBroadcast.create({
        data: {
          title: createAdminBroadcastDto.title.trim(),
          body: createAdminBroadcastDto.body.trim(),
          category,
          forcedLive,
          playerCanDismiss: false,
          createdById: adminId,
        },
        select: adminBroadcastSelect,
      });
    });

    for (const id of deactivatedForcedIds) {
      this.emitBroadcastRemoved(id);
    }

    const payload = this.serializeBroadcast(broadcast);
    this.realtimeService.emitToAllRealtimeClients('admin:broadcast', payload);
    return payload;
  }

  async findAll() {
    const broadcasts = await this.prisma.adminBroadcast.findMany({
      orderBy: { createdAt: 'desc' },
      select: adminBroadcastSelect,
    });

    return broadcasts.map((broadcast) => this.serializeBroadcast(broadcast));
  }

  async setForcedLive(id: string, live: boolean) {
    const existing = await this.prisma.adminBroadcast.findUnique({
      where: { id },
      select: adminBroadcastSelect,
    });

    if (!existing) {
      throw new NotFoundException('Broadcast not found');
    }

    if (existing.category !== AdminBroadcastCategory.FORCED) {
      throw new BadRequestException(
        'Only forced broadcasts can be turned on or off',
      );
    }

    if (live) {
      if (existing.forcedLive) {
        return this.serializeBroadcast(existing);
      }

      let deactivatedForcedIds: string[] = [];
      const broadcast = await this.prisma.$transaction(async (tx) => {
        deactivatedForcedIds = await this.deactivateLiveForcedBroadcasts(
          tx,
          id,
        );
        await tx.adminBroadcastDismissal.deleteMany({
          where: { broadcastId: id },
        });
        return tx.adminBroadcast.update({
          where: { id },
          data: { forcedLive: true },
          select: adminBroadcastSelect,
        });
      });

      for (const deactivatedId of deactivatedForcedIds) {
        this.emitBroadcastRemoved(deactivatedId);
      }

      const payload = this.serializeBroadcast(broadcast);
      this.realtimeService.emitToAllRealtimeClients('admin:broadcast', payload);
      return payload;
    }

    if (!existing.forcedLive) {
      return this.serializeBroadcast(existing);
    }

    const broadcast = await this.prisma.adminBroadcast.update({
      where: { id },
      data: { forcedLive: false },
      select: adminBroadcastSelect,
    });

    this.emitBroadcastRemoved(id);
    return this.serializeBroadcast(broadcast);
  }

  async remind(id: string) {
    const broadcast = await this.prisma.adminBroadcast.findUnique({
      where: { id },
      select: adminBroadcastSelect,
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (broadcast.category !== AdminBroadcastCategory.DISMISSIBLE) {
      throw new BadRequestException(
        'Only dismissible broadcasts can be reminded',
      );
    }

    await this.prisma.adminBroadcastDismissal.deleteMany({
      where: { broadcastId: id },
    });

    const payload = this.serializeBroadcast(broadcast);
    this.realtimeService.emitToAllRealtimeClients(
      'admin:broadcast_remind',
      payload,
    );
    return payload;
  }

  async delete(id: string) {
    const existing = await this.prisma.adminBroadcast.findUnique({
      where: { id },
      select: { id: true, category: true, forcedLive: true },
    });

    if (!existing) {
      throw new NotFoundException('Broadcast not found');
    }

    await this.prisma.adminBroadcast.delete({
      where: { id },
    });

    if (
      existing.category === AdminBroadcastCategory.FORCED &&
      existing.forcedLive
    ) {
      this.emitBroadcastRemoved(id);
    }
    return { success: true };
  }

  async findForUser(userId: string) {
    const forcedRecord = await this.prisma.adminBroadcast.findFirst({
      where: {
        category: AdminBroadcastCategory.FORCED,
        forcedLive: true,
      },
      select: adminBroadcastSelect,
    });

    const inboxRecords = await this.prisma.adminBroadcast.findMany({
      where: {
        category: { not: AdminBroadcastCategory.FORCED },
        dismissals: {
          none: {
            userId,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: adminBroadcastSelect,
    });

    const inboxBroadcasts = inboxRecords.map((broadcast) =>
      this.serializeBroadcast(broadcast),
    );
    const forcedBroadcast = forcedRecord
      ? this.serializeBroadcast(forcedRecord)
      : null;
    const unreadCount = inboxBroadcasts.filter(
      (item) => item.category === AdminBroadcastCategory.DISMISSIBLE,
    ).length;

    return {
      broadcasts: inboxBroadcasts,
      forcedBroadcast,
      unreadCount,
    };
  }

  async dismissForUser(userId: string, broadcastId: string) {
    const broadcast = await this.prisma.adminBroadcast.findUnique({
      where: { id: broadcastId },
      select: { id: true, category: true },
    });

    if (!broadcast) {
      throw new NotFoundException('Broadcast not found');
    }

    if (broadcast.category !== AdminBroadcastCategory.DISMISSIBLE) {
      throw new BadRequestException(
        'This broadcast cannot be dismissed by players',
      );
    }

    await this.prisma.adminBroadcastDismissal.upsert({
      where: {
        broadcastId_userId: {
          broadcastId,
          userId,
        },
      },
      create: {
        broadcastId,
        userId,
      },
      update: {},
    });

    return { success: true };
  }

  private async deactivateLiveForcedBroadcasts(
    tx: PrismaClientLike,
    exceptId?: string,
  ): Promise<string[]> {
    const liveForced = await tx.adminBroadcast.findMany({
      where: {
        category: AdminBroadcastCategory.FORCED,
        forcedLive: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (liveForced.length === 0) {
      return [];
    }

    const ids = liveForced.map((item) => item.id);
    await tx.adminBroadcast.updateMany({
      where: { id: { in: ids } },
      data: { forcedLive: false },
    });
    return ids;
  }

  private emitBroadcastRemoved(id: string) {
    this.realtimeService.emitToAllRealtimeClients('admin:broadcast_removed', {
      id,
    });
  }

  private serializeBroadcast(broadcast: AdminBroadcastRecord) {
    return {
      id: broadcast.id,
      title: broadcast.title,
      body: broadcast.body,
      category: broadcast.category,
      forcedLive: broadcast.forcedLive,
      playerCanDismiss: broadcast.playerCanDismiss,
      createdAt: broadcast.createdAt.toISOString(),
      createdById: broadcast.createdById,
    };
  }
}
