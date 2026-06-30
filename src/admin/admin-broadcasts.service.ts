import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminBroadcastCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateAdminBroadcastDto } from './dto/create-admin-broadcast.dto';

const adminBroadcastSelect = {
  id: true,
  title: true,
  body: true,
  category: true,
  createdAt: true,
  createdById: true,
} as const;

type AdminBroadcastRecord = {
  id: string;
  title: string;
  body: string;
  category: AdminBroadcastCategory;
  createdAt: Date;
  createdById: string | null;
};

@Injectable()
export class AdminBroadcastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async create(adminId: string, createAdminBroadcastDto: CreateAdminBroadcastDto) {
    const category =
      createAdminBroadcastDto.category ?? AdminBroadcastCategory.DISMISSIBLE;
    let removedForcedIds: string[] = [];

    const broadcast = await this.prisma.$transaction(async (tx) => {
      if (category === AdminBroadcastCategory.FORCED) {
        const existingForced = await tx.adminBroadcast.findMany({
          where: { category: AdminBroadcastCategory.FORCED },
          select: { id: true },
        });
        removedForcedIds = existingForced.map((item) => item.id);

        if (removedForcedIds.length > 0) {
          await tx.adminBroadcast.deleteMany({
            where: { category: AdminBroadcastCategory.FORCED },
          });
        }
      }

      return tx.adminBroadcast.create({
        data: {
          title: createAdminBroadcastDto.title.trim(),
          body: createAdminBroadcastDto.body.trim(),
          category,
          createdById: adminId,
        },
        select: adminBroadcastSelect,
      });
    });

    for (const id of removedForcedIds) {
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

  async delete(id: string) {
    try {
      await this.prisma.adminBroadcast.delete({
        where: { id },
      });
    } catch {
      throw new NotFoundException('Broadcast not found');
    }

    this.emitBroadcastRemoved(id);
    return { success: true };
  }

  async findForUser(userId: string) {
    const broadcasts = await this.prisma.adminBroadcast.findMany({
      where: {
        dismissals: {
          none: {
            userId,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: adminBroadcastSelect,
    });

    const items = broadcasts.map((broadcast) => this.serializeBroadcast(broadcast));
    const forcedBroadcast =
      items.find((item) => item.category === AdminBroadcastCategory.FORCED) ??
      null;
    const inboxBroadcasts = items.filter(
      (item) => item.category !== AdminBroadcastCategory.FORCED,
    );
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
      throw new BadRequestException('Only dismissible broadcasts can be dismissed');
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
      createdAt: broadcast.createdAt.toISOString(),
      createdById: broadcast.createdById,
    };
  }
}
