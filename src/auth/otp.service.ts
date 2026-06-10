import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const DEV_MOCK_OTP = '1234';

type OtpPurpose = 'REGISTER' | 'PASSWORD_RESET';

interface StoredOtpChallenge {
  phoneNumber: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

@Injectable()
export class OtpService {
  private readonly challenges = new Map<string, StoredOtpChallenge>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async requestRegisterOtp(phoneNumber: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Phone number is already registered');
    }

    await this.issueChallenge(phoneNumber, 'REGISTER');

    return {
      message: 'Registration OTP sent successfully',
    };
  }

  async requestPasswordResetOtp(phoneNumber: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (existingUser) {
      await this.issueChallenge(phoneNumber, 'PASSWORD_RESET');
    }

    return {
      message: existingUser
        ? 'Password reset OTP sent successfully'
        : 'If the account exists, a password reset OTP has been prepared',
    };
  }

  verifyRegistrationOtp(phoneNumber: string, otp: string): void {
    this.verifyChallengeOrThrow(phoneNumber, 'REGISTER', otp);
  }

  async verifyPasswordResetOtp(
    phoneNumber: string,
    otp: string,
  ): Promise<void> {
    const existingUser = await this.prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    this.verifyChallengeOrThrow(phoneNumber, 'PASSWORD_RESET', otp);
  }

  private async issueChallenge(
    phoneNumber: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const code = this.generateOtpCode();
    const expiresAt = new Date(
      Date.now() + this.getOtpExpiresMinutes() * 60_000,
    );

    this.challenges.set(this.challengeKey(phoneNumber, purpose), {
      phoneNumber,
      purpose,
      codeHash: this.hashOtp(code),
      expiresAt,
      attempts: 0,
    });

    if (purpose === 'PASSWORD_RESET') {
      const existingUser = await this.prisma.user.findUnique({
        where: { phoneNumber },
        select: { id: true },
      });

      if (!existingUser) {
        return;
      }
    }

    if (!this.isProduction()) {
      // Development and test environments can inspect issued OTPs locally.
      console.info(
        `[OTP:${purpose}] phone=${phoneNumber} code=${code} expiresAt=${expiresAt.toISOString()}`,
      );
    }
  }

  private verifyChallengeOrThrow(
    phoneNumber: string,
    purpose: OtpPurpose,
    otp: string,
  ): void {
    const key = this.challengeKey(phoneNumber, purpose);
    const challenge = this.challenges.get(key);

    if (!challenge) {
      throw new UnauthorizedException('OTP expired or not requested');
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      this.challenges.delete(key);
      throw new UnauthorizedException('OTP expired or not requested');
    }

    if (challenge.attempts >= this.getOtpMaxAttempts()) {
      this.challenges.delete(key);
      throw new UnauthorizedException('OTP attempts exceeded');
    }

    const normalizedOtp = otp.trim();
    const isValid = this.hashOtp(normalizedOtp) === challenge.codeHash;

    if (!isValid) {
      challenge.attempts += 1;

      if (challenge.attempts >= this.getOtpMaxAttempts()) {
        this.challenges.delete(key);
        throw new UnauthorizedException('OTP attempts exceeded');
      }

      throw new UnauthorizedException('Invalid OTP');
    }

    this.challenges.delete(key);
  }

  private generateOtpCode(): string {
    if (this.isMockOtpAllowed()) {
      return DEV_MOCK_OTP;
    }

    return String(randomInt(1000, 10000));
  }

  private isMockOtpAllowed(): boolean {
    if (this.isProduction()) {
      return false;
    }

    return this.configService.get<boolean>('OTP_ALLOW_MOCK') === true;
  }

  private isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  private getOtpExpiresMinutes(): number {
    return this.configService.get<number>('OTP_EXPIRES_MINUTES') ?? 10;
  }

  private getOtpMaxAttempts(): number {
    return this.configService.get<number>('OTP_MAX_ATTEMPTS') ?? 5;
  }

  private challengeKey(phoneNumber: string, purpose: OtpPurpose): string {
    return `${purpose}:${phoneNumber}`;
  }

  private hashOtp(otp: string): string {
    return createHash('sha256').update(otp).digest('hex');
  }

  /** Test helper */
  clearChallengesForTests(): void {
    this.challenges.clear();
  }

  /** Test helper */
  seedChallengeForTests(
    phoneNumber: string,
    purpose: OtpPurpose,
    otp: string,
    options?: { expiresAt?: Date; attempts?: number },
  ): void {
    this.challenges.set(this.challengeKey(phoneNumber, purpose), {
      phoneNumber,
      purpose,
      codeHash: this.hashOtp(otp),
      expiresAt: options?.expiresAt ?? new Date(Date.now() + 60_000),
      attempts: options?.attempts ?? 0,
    });
  }
}
