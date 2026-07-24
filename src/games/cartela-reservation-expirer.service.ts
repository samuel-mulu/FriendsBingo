import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  buildSessionCartelaChange,
  type SessionCartelaChange,
} from './games.mapper';

const TICK_MS = 1000;

@Injectable()
export class CartelaReservationExpirerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CartelaReservationExpirerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: RealtimeService,
  ) {}

  onModuleInit() {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy() {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick() {
    if (this.shuttingDown || this.ticking) {
      return;
    }

    this.ticking = true;

    try {
      await this.expireDueReservations();
    } catch (error) {
      this.logger.error(
        'Reservation expiry tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.ticking = false;
    }
  }

  async expireDueReservations() {
    const now = new Date();
    const dueReservations = await this.prisma.gameCartelaReservation.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
      },
      select: {
        id: true,
        gameSessionId: true,
        cartelaId: true,
        cartela: { select: { number: true } },
      },
    });

    if (dueReservations.length === 0) {
      return;
    }

    await this.prisma.gameCartelaReservation.updateMany({
      where: {
        id: { in: dueReservations.map((reservation) => reservation.id) },
      },
      data: { status: 'EXPIRED' },
    });

    const sessionIds = [
      ...new Set(
        dueReservations.map((reservation) => reservation.gameSessionId),
      ),
    ];

    const sessions = await this.prisma.gameSession.findMany({
      where: { id: { in: sessionIds } },
      select: {
        id: true,
        gameSlotId: true,
        prizeAmount: true,
        _count: { select: { gameCartelas: true } },
      },
    });

    const changesBySessionId = new Map<string, SessionCartelaChange[]>();
    for (const reservation of dueReservations) {
      const changes = changesBySessionId.get(reservation.gameSessionId) ?? [];
      changes.push(
        buildSessionCartelaChange({
          cartelaId: reservation.cartelaId,
          cartelaNumber: reservation.cartela.number,
          kind: 'AVAILABLE',
        }),
      );
      changesBySessionId.set(reservation.gameSessionId, changes);
    }

    for (const session of sessions) {
      this.realtimeService.emitSessionCartelasUpdated({
        sessionId: session.id,
        slotId: session.gameSlotId,
        prizeAmount: session.prizeAmount.toString(),
        registeredCartelasCount: session._count.gameCartelas,
        changes: changesBySessionId.get(session.id),
      });
    }
  }
}
