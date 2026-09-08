import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ChangeAdminPasswordDto } from '../admin/dto/change-admin-password.dto';
import { JwtPayload } from '../common/types/jwt-payload.type';
import { PrismaService } from '../prisma/prisma.service';
import { serializeUser, serializeUserWithWallet } from '../users/users.mapper';
import { userProfileSelect } from '../users/users.select';
import { walletSelect } from '../wallet/wallet.select';
import { OtpPurpose } from '@prisma/client';
import {
  ethiopianPhoneLookupVariants,
  normalizeEthiopianPhone,
} from '../common/utils/phone.util';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { RefreshTokenDeviceMeta } from './dto/device-meta.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import {
  TelegramCompleteDto,
  TelegramLinkDto,
  TelegramRequestOtpDto,
  TelegramStartDto,
} from './dto/telegram-auth.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { RefreshTokenService, TokenPair } from './refresh-token.service';
import { TelegramAuthService } from './telegram-auth.service';
import { throwUserBlocked } from './user-blocked.exception';

const WELCOME_BONUS_CARTELAS_WHEN_ENABLED = 10;

function isWelcomeBonusEnabled(): boolean {
  return process.env.WELCOME_BONUS_ENABLED === 'true';
}

function resolveWelcomeBonusCartelasAmount(): number {
  return isWelcomeBonusEnabled() ? WELCOME_BONUS_CARTELAS_WHEN_ENABLED : 0;
}

export type WelcomeBonusDeniedReason =
  | 'DEVICE_ALREADY_CLAIMED'
  | 'USER_ALREADY_CLAIMED'
  | 'DEVICE_ID_MISSING';

type WelcomeBonusResolution = {
  amount: number;
  deniedReason: WelcomeBonusDeniedReason | null;
};

const loginUserSelect = Prisma.validator<Prisma.UserSelect>()({
  ...userProfileSelect,
  password: true,
  wallet: {
    select: walletSelect,
  },
});

type LoginUserRecord = Prisma.UserGetPayload<{
  select: typeof loginUserSelect;
}>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly otpService: OtpService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly telegramAuthService: TelegramAuthService,
  ) {}

  async requestRegisterOtp(phoneNumber: string, requestIp?: string) {
    return this.otpService.requestRegisterOtp(
      this.normalizePhoneNumber(phoneNumber),
      requestIp,
    );
  }

  async requestOtp(requestOtpDto: RequestOtpDto, requestIp?: string) {
    const phoneNumber = this.normalizePhoneNumber(requestOtpDto.phone);
    const purpose = requestOtpDto.purpose ?? OtpPurpose.LOGIN;

    return this.otpService.requestOtp(phoneNumber, purpose, { requestIp });
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const phoneNumber = this.normalizePhoneNumber(verifyOtpDto.phone);
    await this.otpService.verifyLoginOtp(phoneNumber, verifyOtpDto.otp);

    const user = await this.findUserByPhone(phoneNumber, loginUserSelect);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    const authenticatedUser = await this.applyWelcomeBonusIfEligible(
      user,
      verifyOtpDto.deviceId,
    );
    const { accessToken, refreshToken } = await this.createTokenPair(
      authenticatedUser.user,
      verifyOtpDto.deviceId,
    );

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(authenticatedUser.user),
      welcomeBonusCartelasAwarded:
        authenticatedUser.welcomeBonusCartelasAwarded,
    };
  }

  async register(registerDto: RegisterDto) {
    const phoneNumber = this.normalizePhoneNumber(registerDto.phoneNumber);
    await this.otpService.verifyRegistrationOtp(phoneNumber, registerDto.otp);
    const passwordHash = await bcrypt.hash(registerDto.password, 10);
    const deviceId = registerDto.deviceId?.trim() || null;

    try {
      const {
        createdUser,
        welcomeBonusCartelasAwarded,
        welcomeBonusDeniedReason,
      } = await this.prisma.$transaction(async (tx) => {
        const existingUser = await tx.user.findUnique({
          where: { phoneNumber },
          select: { id: true },
        });

        if (existingUser) {
          throw new ConflictException('Phone number is already registered');
        }

        const user = await tx.user.create({
          data: {
            fullName: registerDto.fullName.trim(),
            phoneNumber,
            password: passwordHash,
          },
          select: userProfileSelect,
        });

        const resolution = await this.resolveWelcomeBonusCartelasToAward(
          tx,
          user.id,
          deviceId,
        );
        let bonusAmount = resolution.amount;
        let deniedReason = resolution.deniedReason;

        if (deviceId) {
          const grantResult = await this.recordWelcomeBonusDecision(tx, {
            deviceId,
            userId: user.id,
            phoneNumber,
            bonusAmount,
            deniedReason,
          });
          bonusAmount = grantResult.bonusAmount;
          deniedReason = grantResult.deniedReason;
        }

        const wallet = await tx.wallet.create({
          data: {
            userId: user.id,
            balance: new Prisma.Decimal(0),
            lockedBalance: new Prisma.Decimal(0),
            bonusCartelaBalance: bonusAmount,
          },
          select: walletSelect,
        });

        return {
          createdUser: {
            ...user,
            wallet,
          },
          welcomeBonusCartelasAwarded: bonusAmount,
          welcomeBonusDeniedReason: bonusAmount > 0 ? null : deniedReason,
        };
      });

      const { accessToken, refreshToken } = await this.createTokenPair(
        createdUser,
        deviceId ?? undefined,
      );

      return {
        accessToken,
        refreshToken,
        user: serializeUserWithWallet(createdUser),
        bonusGranted: welcomeBonusCartelasAwarded > 0,
        welcomeBonusCartelasAwarded,
        welcomeBonusDeniedReason,
      };
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async login(loginDto: LoginDto) {
    const phoneNumber = this.normalizePhoneNumber(loginDto.phoneNumber);
    const user = await this.findUserByPhone(phoneNumber, loginUserSelect);

    if (!user?.password) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    const authenticatedUser = await this.applyWelcomeBonusIfEligible(
      user,
      loginDto.deviceId,
    );
    const deviceMeta = this.extractDeviceMeta(loginDto);
    const { accessToken, refreshToken } = await this.createTokenPair(
      authenticatedUser.user,
      loginDto.deviceId,
      deviceMeta,
    );

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(authenticatedUser.user),
      welcomeBonusCartelasAwarded:
        authenticatedUser.welcomeBonusCartelasAwarded,
    };
  }

  async refreshTokens(
    refreshToken: string,
    deviceId?: string,
    meta?: RefreshTokenDeviceMeta,
  ): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
    const { userId } = await this.refreshTokenService.validateRefreshToken(
      refreshToken,
      deviceId,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect,
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      await this.refreshTokenService.revokeAllUserRefreshTokens(userId);
      throwUserBlocked(user.blockReason);
    }

    const { userId: rotatedUserId, newTokenPair } =
      await this.refreshTokenService.rotateRefreshToken(
        refreshToken,
        deviceId,
        meta,
      );

    if (rotatedUserId !== userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const accessToken = await this.signAccessToken(user);

    return {
      accessToken,
      refreshToken: newTokenPair.refreshToken,
      user: serializeUser(user),
    };
  }

  async logout(refreshToken: string, deviceId?: string): Promise<void> {
    try {
      await this.refreshTokenService.validateRefreshToken(
        refreshToken,
        deviceId,
      );
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    } catch {
      // Token invalid or already revoked - consider logout successful
    }
  }

  async listSessions(
    userId: string,
    options?: { refreshToken?: string; deviceId?: string },
  ) {
    const sessions = await this.refreshTokenService.listActiveSessions(userId);
    const currentHash = options?.refreshToken
      ? this.refreshTokenService.hashRefreshToken(options.refreshToken)
      : null;

    return {
      sessions: sessions.map((session) => {
        const isCurrent =
          (currentHash !== null && session.tokenHash === currentHash) ||
          (!!options?.deviceId &&
            !!session.deviceId &&
            session.deviceId === options.deviceId &&
            currentHash === null);

        return {
          id: session.id,
          deviceId: session.deviceId,
          platform: session.platform,
          deviceLabel: session.deviceLabel,
          userAgent: session.userAgent,
          lastUsedAt: session.lastUsedAt,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          isCurrent,
        };
      }),
    };
  }

  async revokeSession(userId: string, sessionId: string) {
    const revoked = await this.refreshTokenService.revokeUserRefreshTokenById(
      userId,
      sessionId,
    );
    if (!revoked) {
      throw new NotFoundException('Session not found');
    }
    return { message: 'Session revoked' };
  }

  async logoutOtherSessions(
    userId: string,
    refreshToken: string,
    deviceId?: string,
  ) {
    const { tokenId } = await this.refreshTokenService.validateRefreshToken(
      refreshToken,
      deviceId,
    );
    await this.refreshTokenService.revokeAllUserRefreshTokens(userId, tokenId);
    return { message: 'Other sessions logged out' };
  }

  private async createTokenPair(
    user: { id: string; phoneNumber: string; role: LoginUserRecord['role'] },
    deviceId?: string,
    meta?: RefreshTokenDeviceMeta,
  ): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user);
    const { token: refreshToken } =
      await this.refreshTokenService.createRefreshToken(
        user.id,
        deviceId,
        meta,
      );

    return { accessToken, refreshToken };
  }

  private extractDeviceMeta(source: {
    platform?: string;
    deviceLabel?: string;
    userAgent?: string;
  }): RefreshTokenDeviceMeta | undefined {
    if (!source.platform && !source.deviceLabel && !source.userAgent) {
      return undefined;
    }
    return {
      platform: source.platform,
      deviceLabel: source.deviceLabel,
      userAgent: source.userAgent,
    };
  }

  private async applyWelcomeBonusIfEligible(
    user: LoginUserRecord,
    deviceId?: string,
  ): Promise<{
    user: LoginUserRecord;
    welcomeBonusCartelasAwarded: number;
  }> {
    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) {
      return {
        user,
        welcomeBonusCartelasAwarded: 0,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const resolution = await this.resolveWelcomeBonusCartelasToAward(
        tx,
        user.id,
        normalizedDeviceId,
      );

      const grantResult = await this.recordWelcomeBonusDecision(tx, {
        deviceId: normalizedDeviceId,
        userId: user.id,
        phoneNumber: user.phoneNumber,
        bonusAmount: resolution.amount,
        deniedReason: resolution.deniedReason,
      });

      if (grantResult.bonusAmount > 0 && grantResult.created) {
        await tx.wallet.update({
          where: { userId: user.id },
          data: {
            bonusCartelaBalance: {
              increment: grantResult.bonusAmount,
            },
          },
        });
      }

      const refreshedUser = await tx.user.findUnique({
        where: { id: user.id },
        select: loginUserSelect,
      });

      if (!refreshedUser) {
        throw new UnauthorizedException('User not found');
      }

      return {
        user: refreshedUser,
        welcomeBonusCartelasAwarded: grantResult.created
          ? grantResult.bonusAmount
          : 0,
      };
    });
  }

  private async resolveWelcomeBonusCartelasToAward(
    tx: Prisma.TransactionClient,
    userId: string,
    deviceId?: string | null,
  ): Promise<WelcomeBonusResolution> {
    if (!isWelcomeBonusEnabled()) {
      return {
        amount: 0,
        deniedReason: null,
      };
    }

    const normalizedDeviceId = deviceId?.trim();
    if (!normalizedDeviceId) {
      return {
        amount: 0,
        deniedReason: 'DEVICE_ID_MISSING',
      };
    }

    const userGrant = await tx.deviceWelcomeBonusGrant.findUnique({
      where: { userId },
      select: { id: true, bonusAmount: true },
    });

    if (userGrant) {
      return {
        amount: 0,
        deniedReason: 'USER_ALREADY_CLAIMED',
      };
    }

    const deviceAward = await tx.deviceWelcomeBonusGrant.findFirst({
      where: {
        deviceId: normalizedDeviceId,
        bonusAmount: { gt: 0 },
      },
      select: { id: true },
    });

    if (deviceAward) {
      return {
        amount: 0,
        deniedReason: 'DEVICE_ALREADY_CLAIMED',
      };
    }

    return {
      amount: resolveWelcomeBonusCartelasAmount(),
      deniedReason: null,
    };
  }

  private async recordWelcomeBonusDecision(
    tx: Prisma.TransactionClient,
    params: {
      deviceId: string;
      userId: string;
      phoneNumber: string;
      bonusAmount: number;
      deniedReason: WelcomeBonusDeniedReason | null;
    },
  ): Promise<{
    created: boolean;
    bonusAmount: number;
    deniedReason: WelcomeBonusDeniedReason | null;
  }> {
    const existingUserGrant = await tx.deviceWelcomeBonusGrant.findUnique({
      where: { userId: params.userId },
      select: { id: true, bonusAmount: true },
    });

    if (existingUserGrant) {
      return {
        created: false,
        bonusAmount: 0,
        deniedReason: 'USER_ALREADY_CLAIMED',
      };
    }

    let bonusAmount = params.bonusAmount;
    let deniedReason = params.deniedReason;

    if (bonusAmount > 0) {
      const positiveGrant = await this.tryCreateWelcomeBonusGrant(tx, {
        deviceId: params.deviceId,
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        bonusAmount,
      });

      if (positiveGrant.created) {
        return {
          created: true,
          bonusAmount,
          deniedReason: null,
        };
      }

      bonusAmount = 0;
      deniedReason = positiveGrant.deniedReason;
    }

    if (
      deniedReason === 'DEVICE_ALREADY_CLAIMED' ||
      deniedReason === 'USER_ALREADY_CLAIMED'
    ) {
      const zeroGrant = await this.tryCreateWelcomeBonusGrant(tx, {
        deviceId: params.deviceId,
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        bonusAmount: 0,
      });

      return {
        created: zeroGrant.created,
        bonusAmount: 0,
        deniedReason,
      };
    }

    return {
      created: false,
      bonusAmount: 0,
      deniedReason,
    };
  }

  private async tryCreateWelcomeBonusGrant(
    tx: Prisma.TransactionClient,
    data: {
      deviceId: string;
      userId: string;
      phoneNumber: string;
      bonusAmount: number;
    },
  ): Promise<
    | { created: true }
    | { created: false; deniedReason: WelcomeBonusDeniedReason }
  > {
    try {
      await tx.deviceWelcomeBonusGrant.create({ data });
      return { created: true };
    } catch (error) {
      if (this.isUniqueConstraintOn(error, 'deviceId')) {
        return {
          created: false,
          deniedReason: 'DEVICE_ALREADY_CLAIMED',
        };
      }

      if (this.isUniqueConstraintOn(error, 'userId')) {
        return {
          created: false,
          deniedReason: 'USER_ALREADY_CLAIMED',
        };
      }

      throw error;
    }
  }

  async requestPasswordResetOtp(phoneNumber: string, requestIp?: string) {
    return this.otpService.requestPasswordResetOtp(
      this.normalizePhoneNumber(phoneNumber),
      requestIp,
    );
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const phoneNumber = this.normalizePhoneNumber(resetPasswordDto.phoneNumber);
    await this.otpService.verifyPasswordResetOtp(
      phoneNumber,
      resetPasswordDto.otp,
    );

    const passwordHash = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    const user = await this.findUserByPhone(phoneNumber, { id: true });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash },
    });

    await this.refreshTokenService.revokeAllUserRefreshTokens(user.id);

    return {
      message: 'Password reset successful',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password: true,
        status: true,
        blockReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    if (!user.password) {
      throw new BadRequestException(
        'Password is not set for this account. Use set password instead.',
      );
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash },
    });

    if (dto.refreshToken?.trim()) {
      try {
        const { tokenId } =
          await this.refreshTokenService.validateRefreshToken(
            dto.refreshToken.trim(),
          );
        await this.refreshTokenService.revokeAllUserRefreshTokens(
          user.id,
          tokenId,
        );
      } catch {
        await this.refreshTokenService.revokeAllUserRefreshTokens(user.id);
      }
    } else {
      await this.refreshTokenService.revokeAllUserRefreshTokens(user.id);
    }

    return {
      message: 'Password changed successfully',
    };
  }

  async changeAdminPassword(
    userId: string,
    changeAdminPasswordDto: ChangeAdminPasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can change admin password');
    }

    return this.changePassword(userId, changeAdminPasswordDto);
  }

  async requestSetPasswordOtp(userId: string, requestIp?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        password: true,
        status: true,
        blockReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    if (user.password) {
      throw new BadRequestException(
        'Password is already set. Use change password instead.',
      );
    }

    return this.otpService.requestSetPasswordOtp(user.phoneNumber, requestIp);
  }

  async setPassword(userId: string, dto: SetPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phoneNumber: true,
        password: true,
        status: true,
        blockReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    if (user.password) {
      throw new BadRequestException(
        'Password is already set. Use change password instead.',
      );
    }

    await this.otpService.verifySetPasswordOtp(user.phoneNumber, dto.otp);

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: passwordHash },
    });

    if (dto.refreshToken?.trim()) {
      try {
        const { tokenId } =
          await this.refreshTokenService.validateRefreshToken(
            dto.refreshToken.trim(),
          );
        await this.refreshTokenService.revokeAllUserRefreshTokens(
          user.id,
          tokenId,
        );
      } catch {
        await this.refreshTokenService.revokeAllUserRefreshTokens(user.id);
      }
    } else {
      await this.refreshTokenService.revokeAllUserRefreshTokens(user.id);
    }

    return {
      message: 'Password set successfully',
    };
  }

  async telegramStart(dto: TelegramStartDto) {
    const identity = this.telegramAuthService.verifyTelegramPayload(
      dto.telegram,
    );

    const existing = await this.prisma.user.findUnique({
      where: { telegramId: identity.telegramId },
      select: loginUserSelect,
    });

    if (existing) {
      if (existing.status === UserStatus.BLOCKED) {
        throwUserBlocked(existing.blockReason);
      }

      const authenticatedUser = await this.applyWelcomeBonusIfEligible(
        existing,
        dto.deviceId,
      );
      const { accessToken, refreshToken } = await this.createTokenPair(
        authenticatedUser.user,
        dto.deviceId,
        this.extractDeviceMeta(dto),
      );

      return {
        status: 'authenticated' as const,
        accessToken,
        refreshToken,
        user: serializeUserWithWallet(authenticatedUser.user),
        welcomeBonusCartelasAwarded:
          authenticatedUser.welcomeBonusCartelasAwarded,
      };
    }

    const { ticket, expiresAt } =
      await this.telegramAuthService.createChallenge(identity);

    return {
      status: 'needs_phone' as const,
      ticket,
      expiresAt,
    };
  }

  async telegramRequestOtp(dto: TelegramRequestOtpDto, requestIp?: string) {
    await this.telegramAuthService.getValidChallenge(dto.ticket);
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    return this.otpService.requestTelegramLinkOtp(phoneNumber, requestIp);
  }

  async telegramComplete(dto: TelegramCompleteDto) {
    const challenge = await this.telegramAuthService.getValidChallenge(
      dto.ticket,
    );
    const phoneNumber = this.normalizePhoneNumber(dto.phoneNumber);
    await this.otpService.verifyTelegramLinkOtp(phoneNumber, dto.otp);

    const deviceId = dto.deviceId?.trim() || null;
    const deviceMeta = this.extractDeviceMeta(dto);

    const existingByPhone = await this.findUserByPhone(
      phoneNumber,
      loginUserSelect,
    );

    if (existingByPhone) {
      if (existingByPhone.status === UserStatus.BLOCKED) {
        throwUserBlocked(existingByPhone.blockReason);
      }

      if (
        existingByPhone.telegramId &&
        existingByPhone.telegramId !== challenge.telegramId
      ) {
        throw new ConflictException(
          'This phone is already linked to a different Telegram account',
        );
      }

      const otherOwner = await this.prisma.user.findFirst({
        where: {
          telegramId: challenge.telegramId,
          id: { not: existingByPhone.id },
        },
        select: { id: true },
      });

      if (otherOwner) {
        throw new ConflictException(
          'This Telegram account is already linked to another user',
        );
      }

      const linkedUser = await this.prisma.user.update({
        where: { id: existingByPhone.id },
        data: {
          telegramId: challenge.telegramId,
          telegramUsername: challenge.telegramUsername,
          telegramFirstName: challenge.firstName,
        },
        select: loginUserSelect,
      });

      await this.telegramAuthService.consumeChallenge(challenge.id);

      const authenticatedUser = await this.applyWelcomeBonusIfEligible(
        linkedUser,
        deviceId ?? undefined,
      );
      const { accessToken, refreshToken } = await this.createTokenPair(
        authenticatedUser.user,
        deviceId ?? undefined,
        deviceMeta,
      );

      return {
        status: 'authenticated' as const,
        accessToken,
        refreshToken,
        user: serializeUserWithWallet(authenticatedUser.user),
        welcomeBonusCartelasAwarded:
          authenticatedUser.welcomeBonusCartelasAwarded,
        linkedExistingAccount: true,
      };
    }

    const otherOwner = await this.prisma.user.findUnique({
      where: { telegramId: challenge.telegramId },
      select: { id: true },
    });
    if (otherOwner) {
      throw new ConflictException(
        'This Telegram account is already linked to another user',
      );
    }

    const fullName = this.telegramAuthService.buildFullName(
      challenge.firstName,
      challenge.lastName,
    );

    try {
      const {
        createdUser,
        welcomeBonusCartelasAwarded,
        welcomeBonusDeniedReason,
      } = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName,
            phoneNumber,
            password: null,
            telegramId: challenge.telegramId,
            telegramUsername: challenge.telegramUsername,
            telegramFirstName: challenge.firstName,
          },
          select: userProfileSelect,
        });

        const resolution = await this.resolveWelcomeBonusCartelasToAward(
          tx,
          user.id,
          deviceId,
        );
        let bonusAmount = resolution.amount;
        let deniedReason = resolution.deniedReason;

        if (deviceId) {
          const grantResult = await this.recordWelcomeBonusDecision(tx, {
            deviceId,
            userId: user.id,
            phoneNumber,
            bonusAmount,
            deniedReason,
          });
          bonusAmount = grantResult.bonusAmount;
          deniedReason = grantResult.deniedReason;
        }

        const wallet = await tx.wallet.create({
          data: {
            userId: user.id,
            balance: new Prisma.Decimal(0),
            lockedBalance: new Prisma.Decimal(0),
            bonusCartelaBalance: bonusAmount,
          },
          select: walletSelect,
        });

        return {
          createdUser: {
            ...user,
            wallet,
          },
          welcomeBonusCartelasAwarded: bonusAmount,
          welcomeBonusDeniedReason: bonusAmount > 0 ? null : deniedReason,
        };
      });

      await this.telegramAuthService.consumeChallenge(challenge.id);

      const { accessToken, refreshToken } = await this.createTokenPair(
        createdUser,
        deviceId ?? undefined,
        deviceMeta,
      );

      return {
        status: 'authenticated' as const,
        accessToken,
        refreshToken,
        user: serializeUserWithWallet(createdUser),
        bonusGranted: welcomeBonusCartelasAwarded > 0,
        welcomeBonusCartelasAwarded,
        welcomeBonusDeniedReason,
        linkedExistingAccount: false,
      };
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async linkTelegram(userId: string, dto: TelegramLinkDto) {
    const identity = this.telegramAuthService.verifyTelegramPayload(
      dto.telegram,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        telegramId: true,
        status: true,
        blockReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    if (user.telegramId && user.telegramId !== identity.telegramId) {
      throw new ConflictException(
        'Account is already linked to a different Telegram user',
      );
    }

    const otherOwner = await this.prisma.user.findFirst({
      where: {
        telegramId: identity.telegramId,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (otherOwner) {
      throw new ConflictException(
        'This Telegram account is already linked to another user',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        telegramId: identity.telegramId,
        telegramUsername: identity.telegramUsername,
        telegramFirstName: identity.firstName,
      },
      select: userProfileSelect,
    });

    return {
      message: 'Telegram linked successfully',
      user: serializeUser(updated),
    };
  }

  async unlinkTelegram(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        password: true,
        telegramId: true,
        status: true,
        blockReason: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throwUserBlocked(user.blockReason);
    }

    if (!user.telegramId) {
      throw new BadRequestException('Telegram is not linked');
    }

    if (!user.password) {
      throw new BadRequestException(
        'Set a password before unlinking Telegram so you can still sign in',
      );
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        telegramId: null,
        telegramUsername: null,
        telegramFirstName: null,
      },
      select: userProfileSelect,
    });

    return {
      message: 'Telegram unlinked successfully',
      user: serializeUser(updated),
    };
  }

  getTelegramWidgetHtml(redirectDeepLinkBase: string): string {
    const botUsername = this.telegramAuthService.getBotUsername();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Continue with Telegram</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; min-height: 100vh;
      align-items: center; justify-content: center; margin: 0; background: #0f172a; color: #e2e8f0; }
    .card { text-align: center; padding: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Friends Bingo</h1>
    <p>Sign in with Telegram</p>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${botUsername}"
      data-size="large"
      data-radius="8"
      data-auth-url="${redirectDeepLinkBase}"
      data-request-access="write"></script>
  </div>
</body>
</html>`;
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    return normalizeEthiopianPhone(phoneNumber.trim());
  }

  private findUserByPhone<T extends Prisma.UserSelect>(
    phoneNumber: string,
    select: T,
  ) {
    return this.prisma.user.findFirst({
      where: {
        OR: ethiopianPhoneLookupVariants(phoneNumber).map((variant) => ({
          phoneNumber: variant,
        })),
      },
      select,
    });
  }

  private async signAccessToken(user: {
    id: string;
    phoneNumber: string;
    role: LoginUserRecord['role'];
  }): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
    };

    return this.jwtService.signAsync(payload);
  }

  private handlePrismaError(error: unknown): void {
    if (this.isUniqueConstraintOn(error, 'phoneNumber')) {
      throw new ConflictException('Phone number is already registered');
    }

    if (this.isUniqueConstraintOn(error, 'telegramId')) {
      throw new ConflictException(
        'This Telegram account is already linked to another user',
      );
    }

    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('Phone number is already registered');
    }
  }

  private isUniqueConstraintError(error: unknown): error is {
    code: string;
    meta?: { target?: string | string[] };
  } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      (error as { code: string }).code === 'P2002'
    );
  }

  private isUniqueConstraintOn(error: unknown, field: string): boolean {
    if (!this.isUniqueConstraintError(error)) {
      return false;
    }

    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target === field || target.includes(field);
    }

    if (Array.isArray(target)) {
      return target.includes(field);
    }

    return false;
  }
}
