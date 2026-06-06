export interface GameOperationPayload {
  slotId: string;
  sessionId: string | null;
  staticCode: string;
  playCode: string | null;
  status: string;
  entryFee: string;
  prizeAmount: string;
  registeredCartelasCount: number;
  calledNumbersCount: number;
  gameRule: {
    id: string;
    key: string;
    name: string;
  } | null;
  sortOrder: number | null;
  updatedReason: string;
}
