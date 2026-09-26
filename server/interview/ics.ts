// Calendar (.ics) export for interview dates. Works with Google, Apple and Outlook calendars.
import type { ApplicationRecord } from "../../shared/types.js";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** One event per interview date, 1 hour long, with a 1-day and a 1-hour reminder. */
export function interviewCalendar(a: ApplicationRecord, siteUrl = ""): string {
  const events = a.interviewDates.map((iso, i) => {
    const start = new Date(iso);
    if (Number.isNaN(start.getTime())) return "";
    const end = new Date(start.getTime() + 3_600_000);
    return [
      "BEGIN:VEVENT",
      `UID:${a.id}-${i}@mycareer.ai`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(`Interview: ${a.role} at ${a.company}`)}`,
      `DESCRIPTION:${esc(`Interview for ${a.role} at ${a.company}.${siteUrl ? ` Prepare in MyCareer.AI: ${siteUrl}` : ""}`)}`,
      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Interview tomorrow", "END:VALARM",
      "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Interview in 1 hour", "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  }).filter(Boolean);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MyCareer.AI//Interviews//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
}
