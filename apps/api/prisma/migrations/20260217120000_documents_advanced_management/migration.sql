-- AlterTable
ALTER TABLE "documents"
  ADD COLUMN "file_hash" TEXT,
  ADD COLUMN "is_pinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "restricted_to_user_id" TEXT,
  ADD COLUMN "deleted_by_id" TEXT;

-- CreateIndex
CREATE INDEX "documents_organization_id_is_pinned_idx" ON "documents"("organization_id", "is_pinned");
CREATE INDEX "documents_organization_id_file_hash_idx" ON "documents"("organization_id", "file_hash");

-- AddForeignKey
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_restricted_to_user_id_fkey"
  FOREIGN KEY ("restricted_to_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
