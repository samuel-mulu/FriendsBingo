import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  ethiopianPhoneLookupVariants,
  normalizeEthiopianPhone,
} from '../common/utils/phone.util';
import { InMemoryRateLimiterService } from '../common/rate-limit/in-memory-rate-limiter.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SmsProviderAuthFailedException,
  SmsRateLimitedException,
  SmsUnavailableException,
} from '../sms/sms.errors';
import { SmsService } from '../sms/sms.service';
import { GEEZSMS_OTP_LENGTH } from '../sms/providers/geezsms.provider';

const INVALID_OTP_MESSAGE = 'Invalid or expired code';
const ETHIO_TELECOM_MOBILE = /^2519\d{8}$/;
const OTP_DIGITS_PATTERN = new RegExp(`^\\d{${GEEZSMS_OTP_LENGTH}}$`);

export type OtpPurposeInput = OtpPurpose;

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly smsService: SmsService,
    private readonly rateLimiter: InMemoryRateLimiterService,
  ) {}

  async requestOtp(
    rawPhone: string,
    purpose: OtpPurposeInput,
    options?: { requestIp?: string; deviceId?: string },
  ) {
    const phoneNumber = normalizeEthiopianPhone(rawPhone);
    this.assertValidGeezPhone(phoneNumber);

    await this.assertPurposeAllowed(phoneNumber, purpose);
    this.assertSendRateLimits(phoneNumber, options?.requestIp);
    await this.assertResendCooldown(phoneNumber, purpose);

    // GeezSMS /sms/otp generates and delivers the code; we only hash for verify.
    const code = await this.deliverOtp(phoneNumber);
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(
      Date.now() + this.getOtpExpiresMinutes() * 60_000,
    );

    await this.prisma.otpChallenge.create({
      data: {
        phoneNumber,
        purpose,
        codeHash,
        expiresAt,
        requestIp: options?.requestIp,
        deviceId: options?.deviceId,
      },
    });

    this.logger.log(
      `OTP challenge created purpose=${purpose} phone=${this.maskPhone(phoneNumber)}`,
    );

    return {
      message: 'OTP sent successfully',
      maskedPhone: this.maskPhone(phoneNumber),
    };
  }

  async requestRegisterOtp(phoneNumber: string, requestIp?: string) {
    return this.requestOtp(phoneNumber, OtpPurpose.REGISTER, { requestIp });
  }

  async requestPasswordResetOtp(phoneNumber: string, requestIp?: string) {
    const normalized = normalizeEthiopianPhone(phoneNumber);
    const existingUser = await this.findUserByPhone(normalized);

    if (existingUser) {
      await this.requestOtp(normalized, OtpPurpose.PASSWORD_RESET, {
        requestIp,
      });
    }

    return {
      message: existingUser
        ? 'Password reset OTP sent successfully'
        : 'If the account exists, a password reset OTP has been prepared',
    };
  }

  async verifyRegistrationOtp(phoneNumber: string, otp: string): Promise<void> {
    await this.verifyOtpOrThrow(phoneNumber, otp, OtpPurpose.REGISTER);
  }

  async verifyPasswordResetOtp(
    phoneNumber: string,
    otp: string,
  ): Promise<void> {
    const existingUser = await this.findUserByPhone(
      normalizeEthiopianPhone(phoneNumber),
    );

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    await this.verifyOtpOrThrow(phoneNumber, otp, OtpPurpose.PASSWORD_RESET);
  }

  async verifyLoginOtp(phoneNumber: string, otp: string): Promise<void> {
    await this.verifyOtpOrThrow(phoneNumber, otp, OtpPurpose.LOGIN);
  }

  private async verifyOtpOrThrow(
    rawPhone: string,
    otp: string,
    purpose: OtpPurposeInput,
  ): Promise<void> {
    const phoneNumber = normalizeEthiopianPhone(rawPhone);
    const trimmedOtp = otp.trim();

    if (!OTP_DIGITS_PATTERN.test(trimmedOtp)) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phoneNumber,
        purpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    if (challenge.attemptCount >= this.getOtpMaxAttempts()) {
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    const isValid = await bcrypt.compare(trimmedOtp, challenge.codeHash);

    if (!isValid) {
      await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new UnauthorizedException(INVALID_OTP_MESSAGE);
    }

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
  }

  private assertValidGeezPhone(phoneNumber: string): void {
    if (!ETHIO_TELECOM_MOBILE.test(phoneNumber)) {
      throw new BadRequestException(
        'Phone number must be a valid Ethiopian mobile (2519xxxxxxxx)',
      );
    }
  }

  private async assertPurposeAllowed(
    phoneNumber: string,
    purpose: OtpPurposeInput,
  ): Promise<void> {
    if (purpose === OtpPurpose.REGISTER) {
      const existingUser = await this.findUserByPhone(phoneNumber);
      if (existingUser) {
        throw new ConflictException('Phone number is already registered');
      }
      return;
    }

    if (purpose === OtpPurpose.LOGIN || purpose === OtpPurpose.PASSWORD_RESET) {
      const existingUser = await this.findUserByPhone(phoneNumber);
      if (!existingUser && purpose === OtpPurpose.LOGIN) {
        throw new NotFoundException('User not found');
      }
    }
  }

  private assertSendRateLimits(phoneNumber: string, requestIp?: string): void {
    const windowMs = this.getSendWindowMinutes() * 60_000;
    const phoneAllowed = this.rateLimiter.consume(
      `otp-send:phone:${phoneNumber}`,
      this.getSendLimitPerPhone(),
      windowMs,
    );

    if (!phoneAllowed) {
      throw new HttpException(
        'Too many OTP requests. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (requestIp) {
      const ipAllowed = this.rateLimiter.consume(
        `otp-send:ip:${requestIp}`,
        this.getSendLimitPerIp(),
        windowMs,
      );

      if (!ipAllowed) {
        throw new HttpException(
          'Too many OTP requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private async assertResendCooldown(
    phoneNumber: string,
    purpose: OtpPurposeInput,
  ): Promise<void> {
    const latest = await this.prisma.otpChallenge.findFirst({
      where: { phoneNumber, purpose },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (!latest) {
      return;
    }

    const elapsedMs = Date.now() - latest.createdAt.getTime();
    const cooldownMs = this.getResendCooldownSeconds() * 1000;

    if (elapsedMs < cooldownMs) {
      throw new HttpException(
        `Please wait ${Math.ceil((cooldownMs - elapsedMs) / 1000)} seconds before requesting another code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async deliverOtp(phoneNumber: string): Promise<string> {
    try {
      const code = await this.smsService.sendOtp(phoneNumber);
      if (!OTP_DIGITS_PATTERN.test(code)) {
        this.logger.warn(
          `GeezSMS returned unexpected OTP length for ${this.maskPhone(phoneNumber)}`,
        );
        throw new SmsUnavailableException();
      }
      return code;
    } catch (error) {
      if (
        error instanceof SmsUnavailableException ||
        error instanceof SmsProviderAuthFailedException ||
        error instanceof SmsRateLimitedException
      ) {
        this.logger.warn(
          `OTP SMS delivery failed for ${this.maskPhone(phoneNumber)}: ${error.message}`,
        );
        throw error;
      }

      this.logger.warn(
        `OTP SMS delivery failed for ${this.maskPhone(phoneNumber)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new SmsUnavailableException();
    }
  }

  private getOtpExpiresMinutes(): number {
    return this.configService.get<number>('OTP_EXPIRES_MINUTES') ?? 5;
  }

  private getOtpMaxAttempts(): number {
    return this.configService.get<number>('OTP_MAX_ATTEMPTS') ?? 8;
  }

  private getResendCooldownSeconds(): number {
    return this.configService.get<number>('OTP_RESEND_COOLDOWN_SECONDS') ?? 30;
  }

  private getSendLimitPerPhone(): number {
    return this.configService.get<number>('OTP_SEND_LIMIT_PER_PHONE') ?? 30;
  }

  private getSendLimitPerIp(): number {
    return this.configService.get<number>('OTP_SEND_LIMIT_PER_IP') ?? 200;
  }

  private getSendWindowMinutes(): number {
    return this.configService.get<number>('OTP_SEND_WINDOW_MINUTES') ?? 15;
  }

  private maskPhone(phoneNumber: string): string {
    if (phoneNumber.length <= 7) {
      return phoneNumber;
    }

    return `${phoneNumber.slice(0, 7)}${'*'.repeat(phoneNumber.length - 7)}`;
  }

  private async findUserByPhone(phoneNumber: string) {
    return this.prisma.user.findFirst({
      where: {
        OR: ethiopianPhoneLookupVariants(phoneNumber).map((variant) => ({
          phoneNumber: variant,
        })),
      },
      select: { id: true, phoneNumber: true, role: true, status: true },
    });
  }

  /** Test helper */
  clearRateLimitsForTests(): void {
    this.rateLimiter.clearForTests();
  }

  /** Test helper */
  async clearChallengesForTests(): Promise<void> {
    await this.prisma.otpChallenge.deleteMany();
  }

  /** Test helper */
  async seedChallengeForTests(
    phoneNumber: string,
    purpose: OtpPurposeInput,
    otp: string,
    options?: { expiresAt?: Date; attemptCount?: number; consumedAt?: Date },
  ): Promise<void> {
    await this.prisma.otpChallenge.create({
      data: {
        phoneNumber: normalizeEthiopianPhone(phoneNumber),
        purpose,
        codeHash: await bcrypt.hash(otp, 10),
        expiresAt: options?.expiresAt ?? new Date(Date.now() + 60_000),
        attemptCount: options?.attemptCount ?? 0,
        consumedAt: options?.consumedAt ?? null,
      },
    });
  }
}
