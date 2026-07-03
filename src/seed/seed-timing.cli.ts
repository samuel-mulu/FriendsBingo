import { runGameTimingConfigSeed } from './seed-game-timing-config';

runGameTimingConfigSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
