-- CreateTable
CREATE TABLE "AppSupportConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "phoneNumber1" TEXT NOT NULL,
    "phoneNumber2" TEXT NOT NULL,
    "telegramUsername" TEXT NOT NULL,
    "termsBody" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSupportConfig_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row with current app defaults
INSERT INTO "AppSupportConfig" (
    "id",
    "phoneNumber1",
    "phoneNumber2",
    "telegramUsername",
    "termsBody",
    "updatedAt"
) VALUES (
    'default',
    '0961355799',
    '0983299318',
    'friendschewata',
    E'Friends Bingo – Terms and Conditions\n\n1. Eligibility\nYou must meet the legal age and local requirements to play bingo games and use wallet features in your region.\n\n2. Accounts\nYou are responsible for keeping your login details secure. One account per player unless approved by support.\n\n3. Wallet and payments\nDeposits and withdrawals are processed according to admin verification rules. Incorrect payment details may delay payouts.\n\n4. Gameplay\nCartela registration, live calls, and bingo claims follow the active game rules shown before each round. Invalid claims may be rejected.\n\n5. Fair play\nAbuse, automation, collusion, or attempts to manipulate game outcomes may result in account suspension.\n\n6. Support\nFor help, contact us using the phone number or Telegram link in the app menu.\n\n7. Changes\nThese terms may be updated. Continued use of the app means you accept the latest version.\n',
    CURRENT_TIMESTAMP
);

-- AddForeignKey
ALTER TABLE "AppSupportConfig" ADD CONSTRAINT "AppSupportConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
