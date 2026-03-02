/**
 * Utilidad para cálculo de plazos legales: días hábiles (excl. fines de semana y festivos).
 * Uso: añadir N días hábiles a una fecha; comprobar si una fecha es hábil.
 */

const SATURDAY = 6;
const SUNDAY = 0;

export interface HolidayLike {
  date: Date;
}

/**
 * Normaliza a fecha sin hora (UTC midnight para comparaciones).
 */
function toDateOnly(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function toTime(date: Date): number {
  return toDateOnly(date).getTime();
}

/**
 * Indica si un día es fin de semana (sábado o domingo).
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === SATURDAY || day === SUNDAY;
}

/**
 * Indica si la fecha es festivo según la lista (fechas en formato Date o string ISO).
 */
export function isHoliday(
  date: Date,
  holidays: Array<Date | string | HolidayLike>,
): boolean {
  const t = toTime(date);
  return holidays.some((h) => {
    const d = typeof h === 'object' && 'date' in h ? h.date : new Date(h as string);
    return toTime(d) === t;
  });
}

/**
 * Indica si la fecha es día hábil (no fin de semana ni festivo).
 */
export function isBusinessDay(
  date: Date,
  holidays: Array<Date | string | HolidayLike> = [],
): boolean {
  return !isWeekend(date) && !isHoliday(date, holidays);
}

/**
 * Añade N días hábiles a una fecha, omitiendo fines de semana y los festivos dados.
 * @param start - Fecha inicial
 * @param businessDays - Número de días hábiles a añadir (debe ser >= 0)
 * @param holidays - Lista de festivos (Date o ISO string o { date: Date })
 * @returns Nueva fecha después de sumar los días hábiles
 */
export function addBusinessDays(
  start: Date,
  businessDays: number,
  holidays: Array<Date | string | HolidayLike> = [],
): Date {
  if (businessDays < 0) {
    throw new Error('businessDays must be >= 0');
  }
  const result = new Date(start);
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result, holidays)) {
      added += 1;
    }
  }
  return result;
}

/**
 * Resta N días hábiles (útil para “días antes del vencimiento”).
 */
export function subtractBusinessDays(
  start: Date,
  businessDays: number,
  holidays: Array<Date | string | HolidayLike> = [],
): Date {
  if (businessDays <= 0) {
    throw new Error('businessDays must be > 0');
  }
  const result = new Date(start);
  let subtracted = 0;
  while (subtracted < businessDays) {
    result.setDate(result.getDate() - 1);
    if (isBusinessDay(result, holidays)) {
      subtracted += 1;
    }
  }
  return result;
}

/**
 * Cuenta los días hábiles entre dos fechas (inclusive start, exclusive end por defecto).
 * Si endBefore = false, end es inclusivo.
 */
export function countBusinessDays(
  start: Date,
  end: Date,
  holidays: Array<Date | string | HolidayLike> = [],
  endInclusive = false,
): number {
  const tStart = toTime(start);
  let tEnd = toTime(end);
  if (endInclusive) {
    tEnd += 24 * 60 * 60 * 1000;
  }
  let count = 0;
  const current = new Date(tStart);
  while (current.getTime() < tEnd) {
    if (isBusinessDay(current, holidays)) count += 1;
    current.setDate(current.getDate() + 1);
  }
  return count;
}
