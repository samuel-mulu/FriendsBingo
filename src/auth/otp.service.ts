import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const FIXED_MOCK_OTP = '1234';

@Injectable()
export class OtpService {
  constructor(private readonly prisma: PrismaService) {}

  async requestRegisterOtp(phoneNumber: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Phone number is already registered');
    }

    // TODO: Integrate a real SMS provider and persist OTP challenge state.
    return {
      message: 'Registration OTP sent successfully',
    };
  }

  async requestPasswordResetOtp(phoneNumber: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    // TODO: Integrate a real SMS provider and persist OTP challenge state.
    // Keep the response generic so the flow can later avoid account enumeration.
    return {
      message: existingUser
        ? 'Password reset OTP sent successfully'
        : 'If the account exists, a password reset OTP has been prepared',
    };
  }

  verifyRegistrationOtp(otp: string): void {
    this.verifyOtpOrThrow(otp);
  }

  async verifyPasswordResetOtp(phoneNumber: string, otp: string): Promise<void> {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    this.verifyOtpOrThrow(otp);
  }

  private verifyOtpOrThrow(otp: string): void {
    if (otp.trim() !== FIXED_MOCK_OTP) {
      throw new UnauthorizedException('Invalid OTP');
    }
  }
}
