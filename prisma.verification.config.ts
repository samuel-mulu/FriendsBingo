import { defineConfig } from 'prisma/config';

// Deliberately does not load .env, DATABASE_URL, or DIRECT_URL.
// Schema provisioning is permitted only on the dedicated SSH-tunnel endpoint.
const databaseUrl = process.env.BINGO_FENCING_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'BINGO_FENCING_TEST_DATABASE_URL is required for verification',
  );
}

let url: URL;
try {
  url = new URL(databaseUrl);
} catch {
  throw new Error('Invalid verification database URL');
}
if (
  url.protocol !== 'postgresql:' ||
  url.hostname !== '127.0.0.1' ||
  url.port !== '65439' ||
  url.pathname !== '/stage2a_claim_fencing'
) {
  throw new Error(
    'Refusing non-isolated verification database; require 127.0.0.1:65439/stage2a_claim_fencing',
  );
}

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: { url: databaseUrl },
});
