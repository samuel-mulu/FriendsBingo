import { GameOperationMode, GameStatus } from '@prisma/client';
import {
  canRegisterForOperationMode,
  DEFAULT_AUTO_CALL_INTERVAL_SECONDS,
  DEFAULT_REGISTRATION_DURATION_SECONDS,
} from './games.operation-mode';

describe('games.operation-mode', () => {
  it('exposes AUTO defaults', () => {
    expect(DEFAULT_REGISTRATION_DURATION_SECONDS).toBe(180);
    expect(DEFAULT_AUTO_CALL_INTERVAL_SECONDS).toBe(15);
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
});
