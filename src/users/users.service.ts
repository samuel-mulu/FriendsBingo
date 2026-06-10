import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import {
  buildPaginationMeta,
  getPaginationParams,
} from '../common/utils/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  serializeAdminUserDetail,
  serializeAdminUserListItem,
  serializeUser,
} from './users.mapper';
import {
  adminUserDetailSelect,
  adminUserListSelect,
  userProfileSelect,
} from './users.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return serializeUser(user);
  }

  async getAdminUsers(paginationQuery: AdminUsersQueryDto) {
    const { page, pageSize, skip, take } = getPaginationParams(paginationQuery);
    const where = paginationQuery.role ? { role: paginationQuery.role } : {};
    const [totalItems, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: adminUserListSelect,
      }),
    ]);

    return {
      items: users.map(serializeAdminUserListItem),
      pagination: buildPaginationMeta(page, pageSize, totalItems),
    };
  }

  async getAdminUserById(userId: string) {
    const [user, winnerCartelas] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: adminUserDetailSelect,
      }),
      this.prisma.gameCartela.count({
        where: { userId, isWinner: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return serializeAdminUserDetail(user, winnerCartelas);
  }
}
