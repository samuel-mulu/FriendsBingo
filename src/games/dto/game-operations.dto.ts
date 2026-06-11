import { GameOperationMode, GameStatus, Prisma } from '@prisma/client';

// Single source of truth for game operations
// Both Admin and Flutter consume this to ensure they display the same game

export interface GameRuleSummary {
  id: string;
  name: string;
  key: string;
}

export interface GameOperationItem {
  // Identifiers
  slotId: string;
  sessionId: string | null;
  staticCode: string;
  playCode: string | null;

  // Status (backend canonical status)
  rawStatus: GameStatus;

  // Player-facing simplified status
  playerStatus:
    | 'registrationOpen'
    | 'playing'
    | 'winnerWindow'
    | 'checking'
    | 'finished'
    | 'cancelled';

  // Operation-facing status for admin UI
  operationStatus: 'live' | 'checking' | 'registration' | 'queue';

  // Game info
  gameRule: GameRuleSummary | null;
  entryFee: string;
  prizePerCartela: string;

  // Session state
  prizeAmount: string;
  companyRevenue?: string; // Only for admin
  registeredCartelasCount: number;
  calledNumbersCount: number;
  sortOrder: number | null;

  // Terminal state
  winnerCartelaId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;

  // Operation flags
  operationMode: GameOperationMode;
  registrationDurationSeconds: number | null;
  autoCallIntervalSeconds: number | null;
  scheduledStartAt: Date | null;
  registrationOpen: boolean;
  canStart: boolean;
  canRegister: boolean;
  canCallNumber: boolean;
  canClaimBingo: boolean;

  winnerWindowStartedAt?: Date | null;
  winnerWindowEndsAt?: Date | null;

  winnerCartelasSummary?: Array<{
    gameCartelaId: string;
    cartelaId: string;
    cartelaNumber: number;
  }>;

  winnerPayoutsSummary?: Array<{
    cartelaId: string;
    cartelaNumber: number;
    amount: string;
    owner?: 'ME' | 'OTHER';
  }>;

  // Latest called number (if playing)
  latestCalledNumber?: {
    letter: string;
    number: number;
    order: number;
  } | null;

  // Backend-owned auto-call (admin live game only)
  autoCallEnabled?: boolean;
  autoCallIntervalMs?: number;
  nextAutoCallAt?: string | null;
}

// Response for GET /games/operations/current
// Backend decides which game is live, checking, registration open
// Frontend must NOT apply additional filtering/sorting
export interface GameOperationsCurrentResponse {
  // Currently playing game (highest priority)
  liveGame: GameOperationItem | null;

  // Game with bingo claim under review
  checkingGame: GameOperationItem | null;

  // Game accepting registrations (NEXT or READY)
  registrationOpenGame: GameOperationItem | null;

  // Queue of upcoming games
  queue: GameOperationItem[];

  // Metadata
  timestamp: string;
  refetchReason?: string;
}

// Player-safe version (hides admin-only fields)
export interface PlayerGameOperationsCurrentResponse {
  liveGame: Omit<GameOperationItem, 'companyRevenue'> | null;
  checkingGame: Omit<GameOperationItem, 'companyRevenue'> | null;
  registrationOpenGame: Omit<GameOperationItem, 'companyRevenue'> | null;
  queue: Omit<GameOperationItem, 'companyRevenue'>[];
  timestamp: string;
  refetchReason?: string;
}
