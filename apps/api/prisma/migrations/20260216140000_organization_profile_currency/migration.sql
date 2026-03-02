-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "address" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "website" TEXT,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';
