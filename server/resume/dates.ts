const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const PRESENT = /^(present|current|currently|till date|to date|now|ongoing|till now|date|today)$/i;

/** Parses "Jan 2020", "January 2020", "01/2020", "2020-01", "2020". Returns [year, month] or null. */
export function parseYearMonth(raw: string | undefined): [number, number] | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/[.,]/g, "");
  let m = s.match(/^([a-z]{3,9})\s*['’]?\s*(\d{4}|\d{2})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4)] || MONTHS[m[1].slice(0, 3)];
    if (mon) return [normYear(m[2]), mon];
  }
  m = s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return [+m[2], +m[1]];
  m = s.match(/^(\d{4})[/-](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return [+m[1], +m[2]];
  m = s.match(/^(\d{4})$/);
  if (m) return [+m[1], 1];
  return null;
}

const normYear = (y: string) => (y.length === 2 ? (+y > 50 ? 1900 + +y : 2000 + +y) : +y);

export const isPresent = (s?: string) => Boolean(s && PRESENT.test(s.trim()));

const monthIndex = (ym: [number, number]) => ym[0] * 12 + (ym[1] - 1);

/** Total professional experience in years, merging overlapping jobs. Deterministic; never trust an LLM for arithmetic. */
export function totalExperienceYears(entries: Array<{ startDate?: string; endDate?: string; current?: boolean }>, now = new Date()): number {
  const nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans: Array<[number, number]> = [];
  for (const e of entries) {
    const start = parseYearMonth(e.startDate);
    if (!start) continue;
    const s = monthIndex(start);
    let end: number;
    if (e.current || isPresent(e.endDate)) end = nowIdx;
    else {
      const parsed = parseYearMonth(e.endDate);
      // A bare end year means the whole year is worked through December.
      end = parsed ? monthIndex(parsed) + (/^\d{4}$/.test((e.endDate || "").trim()) ? 11 : 0) : nowIdx;
    }
    if (end >= s && end - s < 12 * 50) spans.push([s, end + 1]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const sp of spans) {
    if (!cur) cur = [...sp];
    else if (sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
    else {
      total += cur[1] - cur[0];
      cur = [...sp];
    }
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round((total / 12) * 10) / 10;
}

export const MONTH_WORDS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
