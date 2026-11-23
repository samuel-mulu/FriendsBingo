import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { TelegramAuthPayloadDto } from './dto/telegram-auth.dto';

const TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400; // 24h
const TICKET_TTL_MINUTES = 15;

export type VerifiedTelegramIdentity = {
  telegramId: string;
  telegramUsername: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
};

@Injectable()
export class TelegramAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getBotUsername(): string {
    const username = this.configService.get<string>('TELEGRAM_BOT_USERNAME');
    if (!username?.trim()) {
      throw new ServiceUnavailableException('Telegram login is not configured');
    }
    return username.trim().replace(/^@/, '');
  }

  private getBotToken(): string {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token?.trim()) {
      throw new ServiceUnavailableException('Telegram login is not configured');
    }
    return token.trim();
  }

  verifyTelegramPayload(
    payload: TelegramAuthPayloadDto,
  ): VerifiedTelegramIdentity {
    const botToken = this.getBotToken();
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (nowSeconds - payload.auth_date > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
      throw new UnauthorizedException('Telegram login expired. Try again.');
    }

    const dataCheckMap: Record<string, string> = {
      auth_date: String(payload.auth_date),
      id: String(payload.id),
    };

    if (payload.first_name) {
      dataCheckMap.first_name = payload.first_name;
    }
    if (payload.last_name) {
      dataCheckMap.last_name = payload.last_name;
    }
    if (payload.username) {
      dataCheckMap.username = payload.username;
    }
    if (payload.photo_url) {
      dataCheckMap.photo_url = payload.photo_url;
    }

    const dataCheckString = Object.keys(dataCheckMap)
      .sort()
      .map((key) => `${key}=${dataCheckMap[key]}`)
      .join('\n');

    const secretKey = createHash('sha256').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const provided = Buffer.from(payload.hash, 'utf8');
    const expected = Buffer.from(computedHash, 'utf8');

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException('Invalid Telegram login payload');
    }

    return {
      telegramId: String(payload.id),
      telegramUsername: payload.username?.trim() || null,
      firstName: payload.first_name?.trim() || null,
      lastName: payload.last_name?.trim() || null,
      photoUrl: payload.photo_url?.trim() || null,
    };
  }

  verifyTelegramInitData(initData: string): VerifiedTelegramIdentity {
    const botToken = this.getBotToken();
    const params = new URLSearchParams(initData.trim());
    const hash = params.get('hash');

    if (!hash) {
      throw new UnauthorizedException('Missing hash in Telegram initData');
    }

    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      throw new UnauthorizedException('Missing auth_date in Telegram initData');
    }

    const authDate = Number(authDateStr);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Number.isNaN(authDate) || nowSeconds - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
      throw new UnauthorizedException('Telegram login expired. Try again.');
    }

    // Build data-check-string from all key=value pairs except hash, sorted alphabetically
    const pairs: string[] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') {
        pairs.push(`${key}=${value}`);
      }
    });
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    // Telegram Mini App secret key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    const provided = Buffer.from(hash, 'utf8');
    const expected = Buffer.from(computedHash, 'utf8');

    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new UnauthorizedException('Invalid Telegram initData signature');
    }

    const userRaw = params.get('user');
    if (!userRaw) {
      throw new BadRequestException('Missing user field in Telegram initData');
    }

    try {
      const user = JSON.parse(userRaw);
      if (!user.id) {
        throw new BadRequestException('Invalid user ID in Telegram initData');
      }

      return {
        telegramId: String(user.id),
        telegramUsername: user.username?.trim() || null,
        firstName: user.first_name?.trim() || null,
        lastName: user.last_name?.trim() || null,
        photoUrl: user.photo_url?.trim() || null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Failed to parse user data from Telegram initData');
    }
  }

  async createChallenge(
    identity: VerifiedTelegramIdentity,
  ): Promise<{ ticket: string; expiresAt: Date }> {
    const ticket = randomBytes(32).toString('base64url');
    const ticketHash = this.hashTicket(ticket);
    const expiresAt = new Date(Date.now() + TICKET_TTL_MINUTES * 60_000);

    await this.prisma.telegramAuthChallenge.create({
      data: {
        telegramId: identity.telegramId,
        telegramUsername: identity.telegramUsername,
        firstName: identity.firstName,
        lastName: identity.lastName,
        ticketHash,
        expiresAt,
      },
    });

    return { ticket, expiresAt };
  }

  async getValidChallenge(ticket: string) {
    const ticketHash = this.hashTicket(ticket);
    const challenge = await this.prisma.telegramAuthChallenge.findUnique({
      where: { ticketHash },
    });

    if (!challenge || challenge.consumedAt) {
      throw new UnauthorizedException('Invalid or expired Telegram session');
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Telegram session expired. Try again.');
    }

    return challenge;
  }

  async consumeChallenge(challengeId: string): Promise<void> {
    await this.prisma.telegramAuthChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
  }

  buildFullName(firstName: string | null, lastName: string | null): string {
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    if (name.length >= 3) {
      return name.slice(0, 120);
    }
    throw new BadRequestException(
      'Telegram profile must include a name to register',
    );
  }

  private hashTicket(ticket: string): string {
    return createHash('sha256').update(ticket).digest('hex');
  }
}
