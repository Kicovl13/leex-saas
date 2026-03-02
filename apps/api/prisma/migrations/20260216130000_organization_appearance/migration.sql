-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "primary_color" TEXT NOT NULL DEFAULT '#002147',
ADD COLUMN "dark_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "font_family" TEXT NOT NULL DEFAULT 'Inter';
