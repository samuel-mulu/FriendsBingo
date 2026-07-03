import { runAdminSeed } from './seed-admins';

runAdminSeed().catch((error) => {
  console.error('Admin seed failed:', error);
  process.exitCode = 1;
});
