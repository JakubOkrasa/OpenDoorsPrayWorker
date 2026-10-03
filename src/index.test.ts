import { describe, expect, it } from 'vitest';
import { parsePrayerText } from './index';

describe('parsePrayerText', () => {
  it('parses a multi-day prayer text with locations and weekdays', () => {
    const input = `7. Środa
MAURETANIA: Lorem ipsum
lorem
lorem /
8. Czwartek
MALI: Lorem ipsum
lorem
lorem /
9. Piątek
BURKINA FASO: Lorem ipsum
lorem
lorem`;

  it('splits input into exactly three day entries when there are three prayer days', () => {
    const result = parsePrayerText(`7. Środa
MAURETANIA: Pierwsza intencja. /
8. Czwartek
MALI: Druga intencja. /
9. Piątek
BURKINA FASO: Trzecia intencja.`, 2025, 2);

    expect(result).toHaveLength(3);
    expect(result.map(item => item.day_of_month)).toEqual([7, 8, 9]);
    expect(result.map(item => item.weekday)).toEqual(['Środa', 'Czwartek', 'Piątek']);
    expect(result.map(item => item.location)).toEqual(['MAURETANIA', 'MALI', 'BURKINA FASO']);
    expect(result.map(item => item.content)).toEqual([
      'Pierwsza intencja.',
      'Druga intencja.',
      'Trzecia intencja.'
    ]);
  });

  it('returns an empty list when there are no day headers', () => {
    expect(parsePrayerText('Brak danych', 2025, 2)).toEqual([]);
  });
});
