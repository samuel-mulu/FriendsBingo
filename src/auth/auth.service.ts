import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { OtpService } from './otp.service';
import { RefreshTokenService, TokenPair } from './refresh-token.service';

const WELCOME_BONUS_CARTELAS = 10;

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
      throw new ForbiddenException('User account is blocked');
    }

    const authenticatedUser = await this.applyWelcomeBonusIfEligible(
      user,
      verifyOtpDto.deviceId,
    );
    const { accessToken, refreshToken } = await this.createTokenPair(
      authenticatedUser.user,
      verifyOtpDto.deviceId,
    );
    const { password: _password, ...safeUser } = authenticatedUser.user;

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(safeUser),
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
      throw new ForbiddenException('User account is blocked');
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
    const { accessToken, refreshToken } = await this.createTokenPair(
      authenticatedUser.user,
      loginDto.deviceId,
    );
    const { password: _password, ...safeUser } = authenticatedUser.user;

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(safeUser),
      welcomeBonusCartelasAwarded:
        authenticatedUser.welcomeBonusCartelasAwarded,
    };
  }

  async refreshTokens(
    refreshToken: string,
    deviceId?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
    const { userId, newTokenPair } =
      await this.refreshTokenService.rotateRefreshToken(refreshToken, deviceId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect,
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException('User account is blocked');
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
      // Validate the token first to get the user info
      await this.refreshTokenService.validateRefreshToken(
        refreshToken,
        deviceId,
      );
      // Revoke the specific refresh token
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    } catch {
      // Token invalid or already revoked - consider logout successful
    }
  }

  private async createTokenPair(
    user: { id: string; phoneNumber: string; role: LoginUserRecord['role'] },
    deviceId?: string,
  ): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user);
    const { token: refreshToken } =
      await this.refreshTokenService.createRefreshToken(user.id, deviceId);

    return { accessToken, refreshToken };
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
      amount: WELCOME_BONUS_CARTELAS,
      deniedReason: null,
    };
  }

  /**
   * Permanently records the welcome-bonus decision for a user.
   * - amount 10: first eligible device claim
   * - amount 0: denied (e.g. device already used) so later phones cannot award
   */
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

    return {
      message: 'Password reset successful',
    };
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
