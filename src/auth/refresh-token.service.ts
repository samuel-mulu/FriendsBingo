import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { RefreshTokenDeviceMeta } from './dto/device-meta.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async createRefreshToken(
    userId: string,
    deviceId?: string,
    meta?: RefreshTokenDeviceMeta,
  ): Promise<{ token: string; expiresAt: Date; tokenId: string }> {
    const token = this.generateSecureToken();
    const tokenHash = this.hashToken(token);
    const expiresInDays = this.getRefreshTokenExpiresDays();
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );

    const created = await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        deviceId: deviceId || null,
        platform: meta?.platform?.trim() || null,
        deviceLabel: meta?.deviceLabel?.trim() || null,
        userAgent: meta?.userAgent?.trim() || null,
        lastUsedAt: new Date(),
        expiresAt,
      },
      select: { id: true },
    });

    return { token, expiresAt, tokenId: created.id };
  }

  async validateRefreshToken(
    token: string,
    deviceId?: string,
  ): Promise<{ userId: string; tokenId: string }> {
    const tokenHash = this.hashToken(token);

    const refreshToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!refreshToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (refreshToken.revokedAt) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    if (refreshToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (
      deviceId &&
      refreshToken.deviceId &&
      refreshToken.deviceId !== deviceId
    ) {
      throw new UnauthorizedException('Refresh token device mismatch');
    }

    return { userId: refreshToken.userId, tokenId: refreshToken.id };
  }

  async rotateRefreshToken(
    oldToken: string,
    deviceId?: string,
    meta?: RefreshTokenDeviceMeta,
  ): Promise<{ userId: string; newTokenPair: TokenPair }> {
    const { userId, tokenId } = await this.validateRefreshToken(
      oldToken,
      deviceId,
    );

    await this.revokeRefreshTokenById(tokenId);

    const { token: newRefreshToken } = await this.createRefreshToken(
      userId,
      deviceId,
      meta,
    );

    return {
      userId,
      newTokenPair: {
        accessToken: '',
        refreshToken: newRefreshToken,
      },
    };
  }

  async touchLastUsed(tokenId: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { lastUsedAt: new Date() },
    });
  }

  async listActiveSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceId: true,
        platform: true,
        deviceLabel: true,
        userAgent: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
        tokenHash: true,
      },
    });
  }

  hashRefreshToken(token: string): string {
    return this.hashToken(token);
  }

  async revokeRefreshToken(token: string): Promise<void> {
    const tokenHash = this.hashToken(token);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  async revokeRefreshTokenById(tokenId: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  async revokeUserRefreshTokenById(
    userId: string,
    tokenId: string,
  ): Promise<boolean> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        id: tokenId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return result.count > 0;
  }

  async revokeAllUserRefreshTokens(
    userId: string,
    exceptTokenId?: string,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptTokenId && { id: { not: exceptTokenId } }),
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeDeviceRefreshTokens(
    userId: string,
    deviceId: string,
  ): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        deviceId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async cleanupExpiredTokens(): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
    return result.count;
  }

  private generateSecureToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getRefreshTokenExpiresDays(): number {
    return this.configService.get<number>('REFRESH_TOKEN_EXPIRES_DAYS') ?? 90;
  }
}
