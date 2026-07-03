import { runCartelaSeed } from '../seed/seed-cartelas';

runCartelaSeed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
