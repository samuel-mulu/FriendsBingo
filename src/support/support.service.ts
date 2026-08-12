import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlayerSupportCategory,
  PlayerSupportStatus,
  Prisma,
} from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { UserActionRateLimitService } from '../common/rate-limit/user-action-rate-limit.service';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AdminCreateSupportMessageDto } from './dto/admin-create-support-message.dto';
import { CreateSupportMessageDto } from './dto/create-support-message.dto';
import { ReplySupportMessageDto } from './dto/reply-support-message.dto';
import { SupportMessagesQueryDto } from './dto/support-messages-query.dto';
import {
  serializeAdminSupportMessage,
  serializeSupportMessage,
} from './support.mapper';
import {
  adminPlayerSupportMessageSelect,
  playerSupportMessageSelect,
} from './support.select';

const ADMIN_INITIATED_MESSAGE_PLACEHOLDER = 'Message from admin';

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userActionRateLimitService: UserActionRateLimitService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async createMessage(userId: string, dto: CreateSupportMessageDto) {
    this.userActionRateLimitService.assertWithinLimit(
      'support_message',
      userId,
    );

    const message = await this.prisma.playerSupportMessage.create({
      data: {
        userId,
        category: dto.category,
        message: dto.message,
      },
      select: playerSupportMessageSelect,
    });

    const payload = serializeSupportMessage(message);
    this.realtimeService.emitToAdmin('support:new_message', payload);

    return payload;
  }

  async findMyMessages(userId: string, paginationQuery: PaginationQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const where = { userId };

    const [totalItems, messages] = await Promise.all([
      this.prisma.playerSupportMessage.count({ where }),
      this.prisma.playerSupportMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: playerSupportMessageSelect,
      }),
    ]);

    return {
      items: messages.map(serializeSupportMessage),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async getMyUnreadReplyCount(userId: string) {
    // Unseen: never opened hub after reply, or opened before a newer reply.
    const rows = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "PlayerSupportMessage"
      WHERE "userId" = ${userId}
        AND "status" = 'REPLIED'
        AND "adminReply" IS NOT NULL
        AND (
          "playerSeenAt" IS NULL
          OR (
            "repliedAt" IS NOT NULL
            AND "playerSeenAt" < "repliedAt"
          )
        )
    `;

    return { count: Number(rows[0]?.count ?? 0) };
  }

  async markMyRepliesSeen(userId: string) {
    const now = new Date();
    const result = await this.prisma.playerSupportMessage.updateMany({
      where: {
        userId,
        status: PlayerSupportStatus.REPLIED,
        adminReply: { not: null },
      },
      data: { playerSeenAt: now },
    });

    return { updated: result.count };
  }

  async getOpenMessageCount() {
    const count = await this.prisma.playerSupportMessage.count({
      where: { status: PlayerSupportStatus.OPEN },
    });
    return { count };
  }

  async findAdminMessages(query: SupportMessagesQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(query);
    const where: Prisma.PlayerSupportMessageWhereInput = query.status
      ? { status: query.status }
      : {};

    const [totalItems, messages] = await Promise.all([
      this.prisma.playerSupportMessage.count({ where }),
      this.prisma.playerSupportMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminPlayerSupportMessageSelect,
      }),
    ]);

    return {
      items: messages.map(serializeAdminSupportMessage),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async findAdminMessageById(messageId: string) {
    const message = await this.prisma.playerSupportMessage.findUnique({
      where: { id: messageId },
      select: adminPlayerSupportMessageSelect,
    });

    if (!message) {
      throw new NotFoundException('Support message not found');
    }

    return serializeAdminSupportMessage(message);
  }

  async createAsAdmin(adminId: string, dto: AdminCreateSupportMessageDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const now = new Date();
    const message = await this.prisma.playerSupportMessage.create({
      data: {
        userId: dto.userId,
        category: dto.category ?? PlayerSupportCategory.OTHER,
        message: ADMIN_INITIATED_MESSAGE_PLACEHOLDER,
        status: PlayerSupportStatus.REPLIED,
        adminReply: dto.adminReply,
        repliedAt: now,
        repliedById: adminId,
        playerSeenAt: null,
      },
      select: adminPlayerSupportMessageSelect,
    });

    const payload = serializeAdminSupportMessage(message);
    this.realtimeService.emitToAdmin('support:new_message', payload);
    this.realtimeService.emitToAdmin('support:updated', {
      id: message.id,
      status: message.status,
    });
    this.realtimeService.emitToUser(dto.userId, 'support:reply', {
      id: message.id,
      status: message.status,
    });

    return payload;
  }

  async replyAsAdmin(
    messageId: string,
    adminId: string,
    dto: ReplySupportMessageDto,
  ) {
    if (!dto.adminReply && !dto.status) {
      throw new BadRequestException('Provide adminReply and/or status');
    }

    const existing = await this.prisma.playerSupportMessage.findUnique({
      where: { id: messageId },
      select: { id: true, userId: true },
    });

    if (!existing) {
      throw new NotFoundException('Support message not found');
    }

    const data: Prisma.PlayerSupportMessageUpdateInput = {};

    if (dto.adminReply) {
      data.adminReply = dto.adminReply;
      data.repliedAt = new Date();
      data.repliedBy = { connect: { id: adminId } };
      data.status = PlayerSupportStatus.REPLIED;
      data.playerSeenAt = null;
    }

    if (dto.status) {
      data.status = dto.status;
    }

    const message = await this.prisma.playerSupportMessage.update({
      where: { id: messageId },
      data,
      select: adminPlayerSupportMessageSelect,
    });

    const payload = serializeAdminSupportMessage(message);
    this.realtimeService.emitToAdmin('support:updated', {
      id: message.id,
      status: message.status,
    });

    if (dto.adminReply) {
      this.realtimeService.emitToUser(existing.userId, 'support:reply', {
        id: message.id,
        status: message.status,
      });
    }

    return payload;
  }
}
