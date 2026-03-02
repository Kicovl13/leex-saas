/*
  Warnings:

  - A unique constraint covering the columns `[public_token]` on the table `matters` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "MatterStage" AS ENUM ('BORRADOR', 'PRESENTADO', 'PRUEBAS', 'SENTENCIA', 'EJECUCION');

-- CreateEnum
CREATE TYPE "MatterActivityType" AS ENUM ('DOCUMENT_UPLOAD', 'STATUS_CHANGE', 'STAGE_CHANGE', 'NOTE', 'TIME_ENTRY', 'TASK_COMPLETED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "folder" TEXT;

-- AlterTable
ALTER TABLE "matters" ADD COLUMN     "public_token" TEXT,
ADD COLUMN     "responsible_user_id" TEXT,
ADD COLUMN     "stage" "MatterStage" NOT NULL DEFAULT 'BORRADOR';

-- CreateTable
CREATE TABLE "matter_activities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "type" "MatterActivityType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "user_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matter_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "old_data" JSONB,
    "new_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matter_activities_organization_id_idx" ON "matter_activities"("organization_id");

-- CreateIndex
CREATE INDEX "matter_activities_matter_id_idx" ON "matter_activities"("matter_id");

-- CreateIndex
CREATE INDEX "matter_activities_matter_id_created_at_idx" ON "matter_activities"("matter_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "matters_public_token_key" ON "matters"("public_token");

-- CreateIndex
CREATE INDEX "matters_public_token_idx" ON "matters"("public_token");

-- AddForeignKey
ALTER TABLE "matters" ADD CONSTRAINT "matters_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_activities" ADD CONSTRAINT "matter_activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matter_activities" ADD CONSTRAINT "matter_activities_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
