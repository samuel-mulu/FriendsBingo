import { RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  it('emits to the expected rooms', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const server = { to } as never;
    const service = new RealtimeService();

    service.setServer(server);
    service.emitToGame('game-1', 'game:number_called', { number: 15 });
    service.emitToUser('user-1', 'wallet:updated', { balance: '10.00' });
    service.emitToAdmin('deposit:updated', { id: 'dep-1' });
    service.emitToPublicGames('game:created', { id: 'game-1' });

    expect(to).toHaveBeenNthCalledWith(1, 'game:game-1');
    expect(to).toHaveBeenNthCalledWith(2, 'user:user-1');
    expect(to).toHaveBeenNthCalledWith(3, 'admin');
    expect(to).toHaveBeenNthCalledWith(4, 'games:public');
    expect(emit).toHaveBeenCalledTimes(4);
  });
});
