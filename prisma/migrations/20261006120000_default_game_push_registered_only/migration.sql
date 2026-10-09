-- New users default to REGISTERED_ONLY ("Only when I'm playing").
ALTER TABLE "User" ALTER COLUMN "gamePushMode" SET DEFAULT 'REGISTERED_ONLY';
