import * as fs from 'fs';
import * as path from 'path';

const SEED_DATA_DIR = path.join(process.cwd(), 'prisma', 'seed-data');

export function resolveSeedDataPath(...candidates: string[]) {
  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.join(SEED_DATA_DIR, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    `Seed data file not found. Tried: ${candidates.join(', ')}`,
  );
}

export function resolveCartelaSeedPath() {
  const fromEnv = process.env.SEED_CARTELAS_FILE?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const candidates = [
    path.join(process.cwd(), 'src', 'cartelas', 'cartelas.json'),
    path.join(SEED_DATA_DIR, 'Cartela.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Cartela seed file not found. Tried: ${candidates.join(', ')}`,
  );
}

export function resolveGameRuleSeedPath() {
  return resolveSeedDataPath('GameRule.json', 'GameRule (1).json');
}

export function resolveGameTimingConfigSeedPath() {
  return resolveSeedDataPath('GameTimingConfig.json');
}
