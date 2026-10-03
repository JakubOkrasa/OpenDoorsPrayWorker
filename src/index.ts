export interface Env {
  DB: D1Database;
  API_KEY?: string; // Opcjonalny klucz API skonfigurowany w secretach Cloudflare
}

interface PrayerIntention {
  month: number;
  day_of_month: number;
  weekday: string;
  location: string;
  content: string;
}

/**
 * Logika parsowania tekstu kalendarza modlitw
 */
function parsePrayerText(text: string, month: number): PrayerIntention[] {
  const result: PrayerIntention[] = [];
  
  // Szukamy nagłówków dni, np. "6. Niedziela", "12. Poniedziałek"
  const dayRegex = /(\d+)\.\s+([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+)/g;
  const matches = [...text.matchAll(dayRegex)];

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const dayOfMonth = parseInt(currentMatch[1], 10);
    const weekday = currentMatch[2];

    const start = currentMatch.index! + currentMatch[0].length;
    const end = (i + 1 < matches.length) ? matches[i + 1].index! : text.length;

    const dayContent = text.substring(start, end).trim();

    // Dzielimy zawartość dnia na intencje po separatorze "/"
    const intentions = dayContent.split('/')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const rawIntention of intentions) {
      // Szukamy nazwy kraju na początku intencji (np. "NIGERIA:")
      const locationRegex = /^([A-ZĄĆĘŁŃÓŚŹŻ\s]+):/;
      const locationMatch = rawIntention.match(locationRegex);

      let location = '';
      let content = rawIntention;

      if (locationMatch) {
        location = locationMatch[1].trim();
        content = rawIntention.substring(locationMatch[0].length).trim();
      }

      result.push({
        month,
        day_of_month: dayOfMonth,
        weekday,
        location,
        content
      });
    }
  }

  return result;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Zezwalamy tylko na żądania POST do /api/intentions
    if (request.method !== 'POST' || url.pathname !== '/api/intentions') {
      return new Response(JSON.stringify({ error: 'Not Found lub niepoprawna metoda HTTP' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Weryfikacja klucza API (jeśli został skonfigurowany)
    if (env.API_KEY) {
      const authHeader = request.headers.get('X-API-Key');
      if (authHeader !== env.API_KEY) {
        return new Response(JSON.stringify({ error: 'Brak autoryzacji' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    try {
      const body = await request.json() as {
        month: number;
        text: string;
        overwrite?: boolean;
      };

      if (!body.month || typeof body.month !== 'number' || !body.text) {
        return new Response(JSON.stringify({
          error: 'Wymagane pola: "month" (liczba 1-12) oraz "text" (surowy ciąg znaków).'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 1. Parsowanie tekstu do obiektów
      const intentions = parsePrayerText(body.text, body.month);

      if (intentions.length === 0) {
        return new Response(JSON.stringify({
          warning: 'Nie znaleziono żadnych intencji w przekazanym tekście.',
          parsedCount: 0
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const batchStatements: D1PreparedStatement[] = [];

      // 2. Opcjonalne usunięcie dotychczasowych intencji dla danego miesiąca
      if (body.overwrite) {
        batchStatements.push(
          env.DB.prepare('DELETE FROM calendar_content WHERE month = ?').bind(body.month)
        );
      }

      // 3. Przygotowanie zapytań INSERT
      const insertStmt = env.DB.prepare(
        'INSERT INTO intentions (month, day_of_month, weekday, location, content) VALUES (?, ?, ?, ?, ?)'
      );

      for (const item of intentions) {
        batchStatements.push(
          insertStmt.bind(item.month, item.day_of_month, item.weekday, item.location, item.content)
        );
      }

      // 4. Wykonanie wstawiania masowego w pojedynczej transakcji
      await env.DB.batch(batchStatements);

      return new Response(JSON.stringify({
        success: true,
        month: body.month,
        insertedCount: intentions.length,
        data: intentions
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });

    } catch (err: any) {
      return new Response(JSON.stringify({
        error: 'Błąd serwera podczas przetwarzania intencji',
        details: err.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};