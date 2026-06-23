-- Keep only approved deposits in the ledger history table.
DELETE FROM "Deposit" WHERE "status" <> 'APPROVED';
