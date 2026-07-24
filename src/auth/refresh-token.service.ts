import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

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
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = this.generateSecureToken();
    const tokenHash = this.hashToken(token);
    const expiresInDays = this.getRefreshTokenExpiresDays();
    const expiresAt = new Date(
      Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        deviceId: deviceId || null,
        expiresAt,
      },
    });

    return { token, expiresAt };
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

    // Optionally verify device ID if provided
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
  ): Promise<{ userId: string; newTokenPair: TokenPair }> {
    const { userId, tokenId } = await this.validateRefreshToken(
      oldToken,
      deviceId,
    );

    // Revoke the old token
    await this.revokeRefreshTokenById(tokenId);

    // Create a new refresh token
    const { token: newRefreshToken, expiresAt } = await this.createRefreshToken(
      userId,
      deviceId,
    );

    return {
      userId,
      newTokenPair: {
        accessToken: '', // Will be set by caller
        refreshToken: newRefreshToken,
      },
    };
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
