/**
 * Validación de variables de entorno al arranque.
 * Falla con mensaje claro si falta alguna variable requerida.
 */
const REQUIRED = ['DATABASE_URL', 'CLERK_SECRET_KEY'] as const;

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno requeridas: ${missing.join(', ')}. Configúralas en apps/api/.env (ver .env.example).`,
    );
  }
}
