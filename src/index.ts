export interface Env {
  DB: D1Database;
  ApiKey?: string;
}

export interface CalendarEntry {
  year: number;
  month: number;
  day_of_month: number;
  weekday: string;
  location: string;
  content: string;
}

export function parsePrayerText(text: string, year: number, month: number): CalendarEntry[] {
  const result: CalendarEntry[] = [];
  
  // Szukamy nagłówków dni, np. "7. Środa", "8. Czwartek", "9. Piątek"
  const dayRegex = /(\d+)\.\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)/g;
  const matches = [...text.matchAll(dayRegex)];

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const dayOfMonth = parseInt(currentMatch[1], 10);
    const weekday = currentMatch[2];

    const start = currentMatch.index! + currentMatch[0].length;
    const end = (i + 1 < matches.length) ? matches[i + 1].index! : text.length;

    const dayContent = text.substring(start, end).trim();

    // 1. Dzielimy po separatorze '/'
    // 2. Zamieniamy wszelkie znaki nowej linii (\n) oraz wielokrotne spacje na pojedyncze spacje
    const intentionsRaw = dayContent.split('/')
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(s => s.length > 0);

    for (const rawIntention of intentionsRaw) {
      // Szukamy lokalizacji na początku (wielkie litery + spacje do pierwszego dwukropka)
      const locationRegex = /^([A-ZĄĆĘŁŃÓŚŹŻ\s]+):/;
      const locationMatch = rawIntention.match(locationRegex);

      let location = '';
      let content = rawIntention;

      if (locationMatch) {
        location = locationMatch[1].trim();
        // Pobieramy całą treść po pierwszym dwukropku LOKALIZACJA:
        content = rawIntention.substring(locationMatch[0].length).trim();
      }

      if (content.length > 0) {
        result.push({
          year,
          month,
          day_of_month: dayOfMonth,
          weekday,
          location,
          content
        });
      }
    }
  }

  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== '/api/calendar') {
      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
    }

    // --- METODA GET: Pobieranie intencji dla aplikacji ---
    if (request.method === 'GET') {
      const yearStr = url.searchParams.get('year');
      const monthStr = url.searchParams.get('month');

      if (!yearStr || !monthStr) {
        return new Response(JSON.stringify({ error: 'Wymagane parametry: "year" oraz "month"' }), { status: 400 });
      }

      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);

      const { results } = await env.DB.prepare(
        'SELECT day_of_month, weekday, location, content FROM calendar_content WHERE year = ? AND month = ? ORDER BY day_of_month ASC'
      ).bind(year, month).all();

      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // --- METODA POST: Wstawianie surowego tekstu ---
    if (request.method === 'POST') {
      if (env.ApiKey && request.headers.get('X-API-Key') !== env.ApiKey) {
        return new Response(JSON.stringify({ error: 'Brak autoryzacji' }), { status: 401 });
      }

      const body = await request.json() as {
        year: number;
        month: number;
        text: string;
        overwrite?: boolean;
      };

      if (!body.year || !body.month || !body.text) {
        return new Response(JSON.stringify({ error: 'Wymagane pola: "year", "month" oraz "text"' }), { status: 400 });
      }

      const items = parsePrayerText(body.text, body.year, body.month);
      const statements: D1PreparedStatement[] = [];

      if (body.overwrite) {
        statements.push(
          env.DB.prepare('DELETE FROM calendar_content WHERE year = ? AND month = ?').bind(body.year, body.month)
        );
      }

      const insertStmt = env.DB.prepare(
        'INSERT INTO calendar_content (year, month, day_of_month, weekday, location, content) VALUES (?, ?, ?, ?, ?, ?)'
      );

      for (const item of items) {
        statements.push(
          insertStmt.bind(item.year, item.month, item.day_of_month, item.weekday, item.location, item.content)
        );
      }

      await env.DB.batch(statements);

      return new Response(JSON.stringify({
        success: true,
        year: body.year,
        month: body.month,
        insertedCount: items.length
      }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  },
};