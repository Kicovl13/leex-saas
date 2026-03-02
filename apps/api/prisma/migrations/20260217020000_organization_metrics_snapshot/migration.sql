-- CreateTable
CREATE TABLE "organization_metrics_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "metrics" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_metrics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_metrics_snapshots_organization_id_snapshot_date_key"
ON "organization_metrics_snapshots"("organization_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "organization_metrics_snapshots_organization_id_snapshot_date_idx"
ON "organization_metrics_snapshots"("organization_id", "snapshot_date");

-- AddForeignKey
ALTER TABLE "organization_metrics_snapshots"
ADD CONSTRAINT "organization_metrics_snapshots_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
