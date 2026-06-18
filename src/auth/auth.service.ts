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

    const { accessToken, refreshToken } = await this.createTokenPair(
      user,
      verifyOtpDto.deviceId,
    );
    const { password: _password, ...safeUser } = user;

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(safeUser),
    };
  }

  async register(registerDto: RegisterDto) {
    const phoneNumber = this.normalizePhoneNumber(registerDto.phoneNumber);
    await this.otpService.verifyRegistrationOtp(phoneNumber, registerDto.otp);
    const passwordHash = await bcrypt.hash(registerDto.password, 10);

    try {
      const createdUser = await this.prisma.$transaction(async (tx) => {
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

        const wallet = await tx.wallet.create({
          data: {
            userId: user.id,
            balance: new Prisma.Decimal(0),
            lockedBalance: new Prisma.Decimal(0),
          },
          select: walletSelect,
        });

        return {
          ...user,
          wallet,
        };
      });

      const { accessToken, refreshToken } = await this.createTokenPair(
        createdUser,
        registerDto.deviceId,
      );

      return {
        accessToken,
        refreshToken,
        user: serializeUserWithWallet(createdUser),
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

    const { accessToken, refreshToken } = await this.createTokenPair(
      user,
      loginDto.deviceId,
    );
    const { password: _password, ...safeUser } = user;

    return {
      accessToken,
      refreshToken,
      user: serializeUserWithWallet(safeUser),
    };
  }

  async refreshTokens(
    refreshToken: string,
    deviceId?: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: unknown }> {
    const { userId, newTokenPair } = await this.refreshTokenService.rotateRefreshToken(
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
      await this.refreshTokenService.validateRefreshToken(refreshToken, deviceId);
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
    const { token: refreshToken } = await this.refreshTokenService.createRefreshToken(
      user.id,
      deviceId,
    );

    return { accessToken, refreshToken };
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
    if (this.isUniqueConstraintError(error)) {
      throw new ConflictException('Phone number is already registered');
    }
  }

  private isUniqueConstraintError(error: unknown): error is { code: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      error.code === 'P2002'
    );
  }
}
