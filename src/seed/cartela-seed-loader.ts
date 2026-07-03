import * as fs from 'fs';
import { resolveCartelaSeedPath } from './seed-data-paths';
import { filterCartelaSeedEntries } from './cartela-seed-filter';

export type CartelaBoardColumns = {
  B: Array<number | string>;
  I: Array<number | string>;
  N: Array<number | string>;
  G: Array<number | string>;
  O: Array<number | string>;
};

export type CartelaSeedEntry = {
  number: number;
  board: CartelaBoardColumns;
};

type CartelaRecordSeed = Record<string, CartelaBoardColumns>;

type CartelaArraySeed = Array<{
  number: number;
  b: Array<number | string>;
  i: Array<number | string>;
  n: Array<number | string>;
  g: Array<number | string>;
  o: Array<number | string>;
}>;

function normalizeBoardColumns(
  board: CartelaBoardColumns | CartelaArraySeed[number],
): CartelaBoardColumns {
  if ('B' in board) {
    return board;
  }

  return {
    B: board.b,
    I: board.i,
    N: board.n,
    G: board.g,
    O: board.o,
  };
}

function loadRawCartelaEntries(filePath: string): CartelaSeedEntry[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as
    | CartelaRecordSeed
    | CartelaArraySeed;

  if (Array.isArray(parsed)) {
    return parsed.map((row) => ({
      number: row.number,
      board: normalizeBoardColumns(row),
    }));
  }

  return Object.entries(parsed).map(([number, board]) => ({
    number: Number.parseInt(number, 10),
    board: normalizeBoardColumns(board),
  }));
}

export function loadCartelaSeedEntries(filePath = resolveCartelaSeedPath()) {
  const allEntries = loadRawCartelaEntries(filePath);
  const filteredEntries = filterCartelaSeedEntries(allEntries);

  return {
    filePath,
    totalInFile: allEntries.length,
    excludedCount: allEntries.length - filteredEntries.length,
    entries: filteredEntries,
  };
}
