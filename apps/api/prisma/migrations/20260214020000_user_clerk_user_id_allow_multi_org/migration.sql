-- Permitir que el mismo Clerk user esté en varias organizaciones:
-- quitamos el UNIQUE de clerk_user_id y dejamos solo el compuesto (organization_id, clerk_user_id).
DROP INDEX IF EXISTS "users_clerk_user_id_key";
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");
