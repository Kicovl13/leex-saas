-- AlterTable: presupuesto en horas por expediente
ALTER TABLE "matters" ADD COLUMN IF NOT EXISTS "budget_hours" DECIMAL(10,2);

-- AlterTable: tipo de actividad en time entries
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "activity_type" TEXT;
