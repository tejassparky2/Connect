-- DPDP Act 2023: record affirmative consent to the privacy notice.
ALTER TABLE "users" ADD COLUMN "consentAt" TIMESTAMP(3), ADD COLUMN "consentVersion" TEXT;
