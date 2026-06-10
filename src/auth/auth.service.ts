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
import { serializeUserWithWallet } from '../users/users.mapper';
import { userProfileSelect } from '../users/users.select';
import { walletSelect } from '../wallet/wallet.select';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { OtpService } from './otp.service';

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
  ) {}

  async requestRegisterOtp(phoneNumber: string) {
    return this.otpService.requestRegisterOtp(
      this.normalizePhoneNumber(phoneNumber),
    );
  }

  async register(registerDto: RegisterDto) {
    const phoneNumber = this.normalizePhoneNumber(registerDto.phoneNumber);
    this.otpService.verifyRegistrationOtp(phoneNumber, registerDto.otp);
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

      const accessToken = await this.signAccessToken(createdUser);

      return {
        accessToken,
        user: serializeUserWithWallet(createdUser),
      };
    } catch (error) {
      this.handlePrismaError(error);
      throw error;
    }
  }

  async login(loginDto: LoginDto) {
    const phoneNumber = this.normalizePhoneNumber(loginDto.phoneNumber);
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: loginUserSelect,
    });

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

    const accessToken = await this.signAccessToken(user);
    const { password: _password, ...safeUser } = user;

    return {
      accessToken,
      user: serializeUserWithWallet(safeUser),
    };
  }

  async requestPasswordResetOtp(phoneNumber: string) {
    return this.otpService.requestPasswordResetOtp(
      this.normalizePhoneNumber(phoneNumber),
    );
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const phoneNumber = this.normalizePhoneNumber(resetPasswordDto.phoneNumber);
    await this.otpService.verifyPasswordResetOtp(
      phoneNumber,
      resetPasswordDto.otp,
    );

    const passwordHash = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    const updatedUser = await this.prisma.user.updateMany({
      where: { phoneNumber },
      data: { password: passwordHash },
    });

    if (updatedUser.count !== 1) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'Password reset successful',
    };
  }

  private normalizePhoneNumber(phoneNumber: string): string {
    return phoneNumber.trim();
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
