-- Document intelligence, governance and sharing features

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "classification" TEXT,
  ADD COLUMN IF NOT EXISTS "confidentiality_level" TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS "allowed_roles" JSONB;

ALTER TABLE "document_versions"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS "extracted_text" TEXT,
  ADD COLUMN IF NOT EXISTS "review_requested_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "review_requested_by" TEXT,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "approved_by" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "rejected_by" TEXT,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT;

CREATE TABLE IF NOT EXISTS "document_text_indexes" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL UNIQUE,
  "extracted_text" TEXT NOT NULL,
  "language" TEXT DEFAULT 'es',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_text_indexes_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "document_text_indexes_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "document_text_indexes_organization_id_idx"
  ON "document_text_indexes"("organization_id");

CREATE TABLE IF NOT EXISTS "document_tags" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "score" DOUBLE PRECISION,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_tags_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "document_tags_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_tags_document_id_label_key"
  ON "document_tags"("document_id", "label");
CREATE INDEX IF NOT EXISTS "document_tags_organization_id_idx"
  ON "document_tags"("organization_id");
CREATE INDEX IF NOT EXISTS "document_tags_organization_id_label_idx"
  ON "document_tags"("organization_id", "label");

CREATE TABLE IF NOT EXISTS "document_share_links" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "token" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP,
  "max_uses" INTEGER,
  "used_count" INTEGER NOT NULL DEFAULT 0,
  "revoked_at" TIMESTAMP,
  "watermark_text" TEXT,
  "created_by" TEXT,
  "last_access_ip" TEXT,
  "last_access_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_share_links_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "document_share_links_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "document_share_links_organization_id_idx"
  ON "document_share_links"("organization_id");
CREATE INDEX IF NOT EXISTS "document_share_links_document_id_idx"
  ON "document_share_links"("document_id");
CREATE INDEX IF NOT EXISTS "document_share_links_organization_id_revoked_at_idx"
  ON "document_share_links"("organization_id", "revoked_at");

CREATE TABLE IF NOT EXISTS "document_signature_requests" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "external_request_id" TEXT,
  "signers" JSONB DEFAULT '[]'::jsonb,
  "evidence_url" TEXT,
  "requested_by" TEXT,
  "requested_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "signed_at" TIMESTAMP,
  "cancelled_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_signature_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "document_signature_requests_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "document_signature_requests_organization_id_idx"
  ON "document_signature_requests"("organization_id");
CREATE INDEX IF NOT EXISTS "document_signature_requests_document_id_idx"
  ON "document_signature_requests"("document_id");
CREATE INDEX IF NOT EXISTS "document_signature_requests_organization_id_status_idx"
  ON "document_signature_requests"("organization_id", "status");

CREATE TABLE IF NOT EXISTS "document_retention_policies" (
  "id" TEXT PRIMARY KEY,
  "organization_id" TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "retention_days" INTEGER NOT NULL,
  "auto_hard_delete" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "document_retention_policies_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "document_retention_policies_organization_id_document_type_key"
  ON "document_retention_policies"("organization_id", "document_type");
CREATE INDEX IF NOT EXISTS "document_retention_policies_organization_id_idx"
  ON "document_retention_policies"("organization_id");
