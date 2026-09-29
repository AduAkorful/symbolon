import type { DocumentDraft } from "./document.js";
import { SealError } from "./errors.js";

export interface SeriesSchedule {
  /** Issue date of the first invoice (unix seconds, UTC) */
  start: number;
  periods: number;
  /** "monthly" follows UTC calendar months (day clamped); otherwise a fixed number of days */
  every: "monthly" | { days: number };
  /** Due date = issue date + this many days */
  dueAfterDays: number;
}

const DAY = 86_400;
const MAX_PERIODS = 60;

function addMonths(unix: number, months: number): number {
  const d = new Date(unix * 1000);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return Math.floor(target.getTime() / 1000);
}

/**
 * One draft per period of a recurring series (plan 15): dates and Early Pay tiers shifted, invoice numbers
 * `<base>-01`, `<base>-02`, … The vendor seals them all at once; Symbolon only releases them on schedule.
 */
export function seriesDrafts(template: DocumentDraft, schedule: SeriesSchedule): DocumentDraft[] {
  if (!Number.isInteger(schedule.periods) || schedule.periods < 1 || schedule.periods > MAX_PERIODS) {
    throw new SealError(`a series has 1..${MAX_PERIODS} periods`);
  }
  if (!Number.isInteger(schedule.dueAfterDays) || schedule.dueAfterDays < 0) throw new SealError("dueAfterDays must be a non-negative integer");
  if (schedule.every !== "monthly" && (!Number.isInteger(schedule.every.days) || schedule.every.days < 1)) {
    throw new SealError("a fixed interval is a positive whole number of days");
  }
  const width = String(schedule.periods).length < 2 ? 2 : String(schedule.periods).length;
  return Array.from({ length: schedule.periods }, (_, i) => {
    const issuedAt = schedule.every === "monthly" ? addMonths(schedule.start, i) : schedule.start + i * schedule.every.days * DAY;
    const shift = issuedAt - template.issuedAt;
    return {
      ...template,
      invoiceNumber: `${template.invoiceNumber}-${String(i + 1).padStart(width, "0")}`,
      issuedAt,
      dueDate: issuedAt + schedule.dueAfterDays * DAY,
      earlyPay: template.earlyPay.map((t) => ({ ...t, payBy: t.payBy + shift })),
    };
  });
}
