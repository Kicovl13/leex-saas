import {
  addBusinessDays,
  isWeekend,
  isHoliday,
  isBusinessDay,
  type HolidayLike,
} from './deadline.util';

// Fechas en hora local (año, mes 0-based, día) para evitar fallos por timezone en getDay()
const saturday = new Date(2025, 1, 15);  // 15 feb 2025 = sábado
const sunday = new Date(2025, 1, 16);
const monday = new Date(2025, 1, 17);
const friday = new Date(2025, 1, 14);

describe('deadline.util', () => {
  describe('isWeekend', () => {
    it('returns true for Saturday', () => {
      expect(isWeekend(saturday)).toBe(true);
    });
    it('returns true for Sunday', () => {
      expect(isWeekend(sunday)).toBe(true);
    });
    it('returns false for Monday', () => {
      expect(isWeekend(monday)).toBe(false);
    });
  });

  describe('isHoliday', () => {
    it('returns true when date matches holiday', () => {
      const date = new Date(2025, 11, 25);
      expect(isHoliday(date, [{ date: new Date(2025, 11, 25) }])).toBe(true);
    });
    it('returns false when date is not in list', () => {
      const date = new Date(2025, 11, 26);
      expect(isHoliday(date, [{ date: new Date(2025, 11, 25) }])).toBe(false);
    });
  });

  describe('isBusinessDay', () => {
    it('returns false for Saturday', () => {
      expect(isBusinessDay(saturday)).toBe(false);
    });
    it('returns true for Monday with no holidays', () => {
      expect(isBusinessDay(monday)).toBe(true);
    });
  });

  describe('addBusinessDays', () => {
    it('throws if businessDays < 0', () => {
      expect(() => addBusinessDays(new Date(), -1)).toThrow('businessDays must be >= 0');
    });
    it('returns same date when businessDays is 0', () => {
      const result = addBusinessDays(monday, 0);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(1);
      expect(result.getDate()).toBe(17);
    });
    it('adds 1 business day from Friday to Monday', () => {
      const result = addBusinessDays(friday, 1);
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(1);
      expect(result.getDate()).toBe(17);
    });
    it('skips holidays when provided', () => {
      const tuesday = new Date(2025, 1, 18);
      const result = addBusinessDays(monday, 1, [{ date: tuesday }]);
      expect(result.getDate()).toBe(19);
    });
  });
});
