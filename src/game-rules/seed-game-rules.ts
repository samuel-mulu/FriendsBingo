import { runGameRuleSeedFromJson } from '../seed/seed-game-rules-from-json';

runGameRuleSeedFromJson().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
