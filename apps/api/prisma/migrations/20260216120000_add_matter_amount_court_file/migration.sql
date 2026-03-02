-- AlterTable
ALTER TABLE "matters" ADD COLUMN "amount" DECIMAL(12,2),
ADD COLUMN "court_name" TEXT,
ADD COLUMN "file_number" TEXT;
