-- AlterTable
ALTER TABLE "clients" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "matters" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "templates" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "deadlines" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "time_entries" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "clients_organization_id_deleted_at_idx" ON "clients"("organization_id", "deleted_at");
CREATE INDEX "matters_organization_id_deleted_at_idx" ON "matters"("organization_id", "deleted_at");
CREATE INDEX "documents_organization_id_deleted_at_idx" ON "documents"("organization_id", "deleted_at");
CREATE INDEX "templates_organization_id_deleted_at_idx" ON "templates"("organization_id", "deleted_at");
CREATE INDEX "deadlines_organization_id_deleted_at_idx" ON "deadlines"("organization_id", "deleted_at");
CREATE INDEX "time_entries_organization_id_deleted_at_idx" ON "time_entries"("organization_id", "deleted_at");
CREATE INDEX "tasks_organization_id_deleted_at_idx" ON "tasks"("organization_id", "deleted_at");
CREATE INDEX "invoices_organization_id_deleted_at_idx" ON "invoices"("organization_id", "deleted_at");
