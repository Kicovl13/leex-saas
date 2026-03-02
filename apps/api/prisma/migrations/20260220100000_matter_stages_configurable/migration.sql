-- CreateTable: etapas configurables por organización y tipo de materia
CREATE TABLE "matter_stage_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "matter_type" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matter_stage_definitions_pkey" PRIMARY KEY ("id")
);

-- Convert matters.stage from enum to TEXT (preserva valores existentes)
ALTER TABLE "matters" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "matters" ALTER COLUMN "stage" TYPE TEXT USING "stage"::text;
ALTER TABLE "matters" ALTER COLUMN "stage" SET DEFAULT 'BORRADOR';

-- Drop enum MatterStage
DROP TYPE "MatterStage";

-- Unique + indexes for matter_stage_definitions
CREATE UNIQUE INDEX "matter_stage_definitions_organization_id_matter_type_key_key" ON "matter_stage_definitions"("organization_id", "matter_type", "key");
CREATE INDEX "matter_stage_definitions_organization_id_idx" ON "matter_stage_definitions"("organization_id");
CREATE INDEX "matter_stage_definitions_organization_id_matter_type_idx" ON "matter_stage_definitions"("organization_id", "matter_type");

-- ForeignKey
ALTER TABLE "matter_stage_definitions" ADD CONSTRAINT "matter_stage_definitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
