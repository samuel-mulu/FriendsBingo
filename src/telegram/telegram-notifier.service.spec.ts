import { Logger } from '@nestjs/common';
import { GrammyError } from 'grammy';
import { mapPushRouteToMiniappPath } from './telegram-deeplink.util';
import { TelegramNotifierService } from './telegram-notifier.service';

function grammyError(code: number, retryAfter?: number) {
  return new GrammyError(
    'call failed',
    {
      ok: false,
      error_code: code,
      description:
        code === 403
          ? 'Forbidden: bot was blocked by the user'
          : 'Too Many Requests',
      ...(retryAfter ? { parameters: { retry_after: retryAfter } } : {}),
    },
    'sendMessage',
    {},
  );
}

describe('mapPushRouteToMiniappPath', () => {
  it.each([
    ['/wallet/deposits', '/wallet/deposits'],
    ['/wallet/deposit', '/wallet/deposits'],
    ['/wallet/withdrawals', '/wallet/withdrawals'],
    ['/wallet', '/wallet'],
    ['/games?sessionId=abc-123', '/play/abc-123'],
    ['/games/live?sessionId=abc-123', '/play/abc-123'],
    ['/games/big-game', '/play/big-game'],
    ['/support', '/support'],
    ['/games', '/play'],
    ['/unknown', '/play'],
    [undefined, '/play'],
    ['/games?sessionId=../../evil', '/play'],
  ])('maps %s to %s', (route, expected) => {
    expect(mapPushRouteToMiniappPath(route)).toBe(expected);
  });
});

describe('TelegramNotifierService', () => {
  let prisma: {
    user: { findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };
  let telegram: {
    canSendMessages: jest.Mock;
    buildMiniappUrl: jest.Mock;
    sendUserMessage: jest.Mock;
    onUserInteraction: jest.Mock;
  };
  let service: TelegramNotifierService;
  const payload = {
    category: 'DEPOSIT_APPROVED' as const,
    title: 'Deposit <ok>',
    body: '100 ETB',
    route: '/wallet/deposits',
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'u1', telegramId: '111' }]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    telegram = {
      canSendMessages: jest.fn(() => true),
      buildMiniappUrl: jest.fn((path: string) => `https://mini.app${path}`),
      sendUserMessage: jest.fn().mockResolvedValue(undefined),
      onUserInteraction: jest.fn(),
    };
    service = new TelegramNotifierService(prisma as never, telegram as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('sends an escaped message with a web_app deep link to linked, unblocked users', async () => {
    const summary = await service.notifyUsers(['u1', 'u1', ''], payload);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['u1'] },
        telegramId: { not: null },
        telegramNotificationsBlockedAt: null,
      },
      select: { id: true, telegramId: true },
    });
    expect(telegram.sendUserMessage).toHaveBeenCalledWith(
      '111',
      '<b>Deposit &lt;ok&gt;</b>\n100 ETB',
      { label: expect.any(String), url: 'https://mini.app/wallet/deposits' },
    );
    expect(summary).toMatchObject({
      targeted: 1,
      sent: 1,
      deliveredUserIds: ['u1'],
    });
  });

  it('does nothing when the bot is not configured', async () => {
    telegram.canSendMessages.mockReturnValue(false);
    const summary = await service.notifyUsers(['u1'], payload);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(summary.targeted).toBe(0);
  });

  it('flags users who blocked the bot', async () => {
    telegram.sendUserMessage.mockRejectedValue(grammyError(403));
    const summary = await service.notifyUsers(['u1'], payload);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { telegramNotificationsBlockedAt: expect.any(Date) },
    });
    expect(summary).toMatchObject({
      blocked: 1,
      sent: 0,
      deliveredUserIds: [],
    });
  });

  it('retries once after a 429 retry_after', async () => {
    jest.useFakeTimers();
    telegram.sendUserMessage
      .mockRejectedValueOnce(grammyError(429, 1))
      .mockResolvedValueOnce(undefined);
    const pending = service.notifyUsers(['u1'], payload);
    await jest.advanceTimersByTimeAsync(1000);
    const summary = await pending;
    jest.useRealTimers();
    expect(telegram.sendUserMessage).toHaveBeenCalledTimes(2);
    expect(summary.sent).toBe(1);
  });

  it('clears the blocked flag when a user interacts with the bot again', async () => {
    service.onModuleInit();
    const listener = telegram.onUserInteraction.mock.calls[0][0] as (
      id: string,
    ) => Promise<void>;
    await listener('111');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        telegramId: '111',
        telegramNotificationsBlockedAt: { not: null },
      },
      data: { telegramNotificationsBlockedAt: null },
    });
  });
});
