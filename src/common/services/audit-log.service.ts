import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaDbClient = Prisma.TransactionClient | PrismaService;

interface CreateAuditLogInput {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLogService {
  async create(db: PrismaDbClient, input: CreateAuditLogInput): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        metadata: input.metadata
          ? this.serializeMetadata(input.metadata)
          : undefined,
      },
    });
  }

  async createWithDefaultClient(
    prisma: PrismaService,
    input: CreateAuditLogInput,
  ): Promise<void> {
    await this.create(prisma, input);
  }

  private serializeMetadata(
    metadata: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
  }
}
