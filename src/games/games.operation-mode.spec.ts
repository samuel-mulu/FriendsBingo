import { BadRequestException } from '@nestjs/common';
import { GameOperationMode, GameStatus } from '@prisma/client';
import {
  assertBigGameRegistrationAllowed,
  assertRegistrationAllowed,
  canRegisterForBigGameWindow,
  canRegisterForOperationMode,
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
} from './games.operation-mode';

describe('games.operation-mode', () => {
  it('exposes AUTO defaults', () => {
    expect(DEFAULT_REGISTRATION_DURATION_SECONDS).toBe(180);
    expect(DEFAULT_AUTO_CALL_INTERVAL_SECONDS).toBe(18);
  });

  it('allows READY registration for AUTO and MANUAL', () => {
    expect(
      canRegisterForOperationMode(GameOperationMode.AUTO, GameStatus.READY),
    ).toBe(true);
    expect(
      canRegisterForOperationMode(GameOperationMode.MANUAL, GameStatus.READY),
    ).toBe(true);
  });

  it('blocks PLAYING registration for AUTO', () => {
    expect(
      canRegisterForOperationMode(GameOperationMode.AUTO, GameStatus.PLAYING),
    ).toBe(false);
  });

  it('keeps PLAYING registration for MANUAL', () => {
    expect(
      canRegisterForOperationMode(GameOperationMode.MANUAL, GameStatus.PLAYING),
    ).toBe(true);
  });

  it('opens the Big Game registration window only between open and play times', () => {
    const registrationOpensAt = new Date('2026-07-01T09:00:00.000Z');
    const scheduledStartAt = new Date('2026-07-01T12:00:00.000Z');

    expect(
      canRegisterForBigGameWindow(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T08:59:59.000Z'),
      ),
    ).toBe(false);
    expect(
      canRegisterForBigGameWindow(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T09:00:00.000Z'),
      ),
    ).toBe(true);
    expect(
      canRegisterForBigGameWindow(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T11:59:59.000Z'),
      ),
    ).toBe(true);
    expect(
      canRegisterForBigGameWindow(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T12:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('throws typed errors before Big Game registration opens and after it closes', () => {
    const registrationOpensAt = new Date('2026-07-01T09:00:00.000Z');
    const scheduledStartAt = new Date('2026-07-01T12:00:00.000Z');

    expect(() =>
      assertBigGameRegistrationAllowed(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T08:59:59.000Z'),
      ),
    ).toThrow('Big Game registration is not open yet');

    expect(() =>
      assertBigGameRegistrationAllowed(
        registrationOpensAt,
        scheduledStartAt,
        new Date('2026-07-01T12:00:00.000Z'),
      ),
    ).toThrow('Big Game registration is closed');
  });

  it('throws REGISTRATION_CLOSED for standard games outside the allowed window', () => {
    try {
      assertRegistrationAllowed(GameOperationMode.AUTO, GameStatus.CHECKING);
      throw new Error('expected assertRegistrationAllowed to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'REGISTRATION_CLOSED',
        }),
      );
    }
  });
});
