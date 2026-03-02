-- Task: matterId opcional (recordatorios globales)
ALTER TABLE "tasks" ALTER COLUMN "matter_id" DROP NOT NULL;

-- Template: matterType para filtrar por tipo de expediente
ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "matter_type" TEXT;
CREATE INDEX IF NOT EXISTS "templates_organization_id_matter_type_idx" ON "templates"("organization_id", "matter_type");

-- OrganizationActivityType: tipos de actividad configurables
CREATE TABLE "organization_activity_types" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_activity_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organization_activity_types_organization_id_key_key" ON "organization_activity_types"("organization_id", "key");
CREATE INDEX "organization_activity_types_organization_id_idx" ON "organization_activity_types"("organization_id");

ALTER TABLE "organization_activity_types" ADD CONSTRAINT "organization_activity_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
