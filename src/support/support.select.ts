import { Prisma } from '@prisma/client';

export const playerSupportMessageSelect =
  Prisma.validator<Prisma.PlayerSupportMessageSelect>()({
    id: true,
    userId: true,
    category: true,
    message: true,
    status: true,
    adminReply: true,
    repliedAt: true,
    repliedById: true,
    createdAt: true,
    updatedAt: true,
  });

export const adminPlayerSupportMessageSelect =
  Prisma.validator<Prisma.PlayerSupportMessageSelect>()({
    ...playerSupportMessageSelect,
    user: {
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
      },
    },
  });

export type PlayerSupportMessageRecord = Prisma.PlayerSupportMessageGetPayload<{
  select: typeof playerSupportMessageSelect;
}>;

export type AdminPlayerSupportMessageRecord =
  Prisma.PlayerSupportMessageGetPayload<{
    select: typeof adminPlayerSupportMessageSelect;
  }>;
