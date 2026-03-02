-- CreateTable
CREATE TABLE "deadline_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "court_type" TEXT NOT NULL,
    "legal_basis" TEXT NOT NULL,
    "default_days" INTEGER NOT NULL,
    "is_business_days" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deadline_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deadline_rules_organization_id_idx" ON "deadline_rules"("organization_id");
CREATE INDEX "deadline_rules_organization_id_court_type_idx" ON "deadline_rules"("organization_id", "court_type");
CREATE INDEX "deadline_rules_organization_id_legal_basis_idx" ON "deadline_rules"("organization_id", "legal_basis");
CREATE INDEX "deadline_rules_organization_id_jurisdiction_idx" ON "deadline_rules"("organization_id", "jurisdiction");

-- AddForeignKey
ALTER TABLE "deadline_rules" ADD CONSTRAINT "deadline_rules_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
