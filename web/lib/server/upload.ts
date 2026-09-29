import { ModelRefusal, scanForInstructions, type Extraction, type Signal, type StewardModel } from "@symbolon/steward";
import { UNSAFE_TEXT_G } from "../text-safety";
import { AuthError } from "./errors";

// Plan 05i, V13. An uploaded invoice becomes a *draft* for the composer and nothing else. The Seal, token, chain and payout never
// come from the file; the vendor confirms every field; and text in the file that tries to instruct anyone is shown, never followed.

export const MAX_PDF_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
const READ_TIMEOUT_MS = 90_000;

export interface Prefill {
  client: { name: string; email: string };
  invoiceNumber: string;
  dueDays: string;
  lines: { description: string; quantity: string; unitPrice: string }[];
  poNumber: string;
  notes: string;
}

/** What the file said that the composer can't carry: shown next to the draft for the vendor to compare */
export interface FromFile {
  total: string;
  currency: string;
  taxes: { label: string; amount: string }[];
  discounts: { label: string; amount: string }[];
  issueDate: string;
  dueDate: string;
  /** Text in the file that tries to instruct the reader, verbatim. It is data, not an instruction, and was not followed. */
  instructions: string[];
  signals: Signal[];
}

export type ReadResult = { ok: true; prefill: Prefill; fromFile: FromFile } | { ok: false; reason: string };
export type ReadResultWithExtraction = ({ ok: true; extraction: Extraction; prefill: Prefill; fromFile: FromFile } | { ok: false; reason: string });

const clean = (s: string | null | undefined, max: number) => (s ?? "").replace(UNSAFE_TEXT_G, " ").replace(/\s+/g, " ").trim().slice(0, max);
const plainDecimal = (s: string) => (/^\d{1,12}(\.\d{1,18})?$/.test(s.trim()) ? s.trim() : "");
const EMAIL = /^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$/;

/** Days between the file's issue and due dates, when both read cleanly and fall in 1..365 */
function dueDaysFrom(issue: string, due: string): string {
  const a = Date.parse(`${issue}T00:00:00Z`);
  const b = Date.parse(`${due}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  const days = Math.round((b - a) / 86_400_000);
  return days >= 1 && days <= 365 ? String(days) : "";
}

export function toPrefill(x: Extraction): { prefill: Prefill; fromFile: FromFile } {
  const email = (x.payerEmail ?? "").trim().toLowerCase();
  const notes = [x.terms ? `Terms: ${clean(x.terms, 1800)}` : "", clean(x.notes, 2000)].filter(Boolean).join("\n\n");
  return {
    prefill: {
      client: { name: clean(x.payerName, 200), email: EMAIL.test(email) && email.length <= 254 ? email : "" },
      invoiceNumber: clean(x.invoiceNumber, 100),
      dueDays: dueDaysFrom(x.issueDate, x.dueDate),
      lines: x.lineItems.slice(0, 100).map((l) => ({ description: clean(l.description, 1000), quantity: plainDecimal(l.quantity), unitPrice: plainDecimal(l.unitPrice) })),
      poNumber: clean(x.poNumber, 100),
      notes,
    },
    fromFile: {
      total: clean(x.total, 40),
      currency: clean(x.currency, 16),
      taxes: x.taxes.map((t) => ({ label: clean(t.label, 100), amount: clean(t.amount, 40) })),
      discounts: x.discounts.map((t) => ({ label: clean(t.label, 100), amount: clean(t.amount, 40) })),
      issueDate: clean(x.issueDate, 20),
      dueDate: clean(x.dueDate, 20),
      instructions: x.instructionsFound.map((s) => clean(s, 300)).filter(Boolean).slice(0, 10),
      signals: scanForInstructions(x).slice(0, 10),
    },
  };
}

/**
 * Reads an uploaded invoice through the model into a draft. Wrong types and sizes are refused before the model sees anything; a model
 * that fails, refuses or times out gives a plain reason and the composer opens empty. The file is read in memory and not stored.
 */
export async function readUploadWithExtraction(model: StewardModel, file: { bytes: Uint8Array; name?: string }): Promise<ReadResultWithExtraction> {
  const { bytes } = file;
  if (bytes.length === 0) throw new AuthError(400, "That file is empty.");
  const isPdf = bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  let input: { pdfBase64: string } | { text: string };
  if (isPdf) {
    if (bytes.length > MAX_PDF_BYTES) throw new AuthError(400, `That PDF is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    input = { pdfBase64: Buffer.from(bytes).toString("base64") };
  } else {
    if (bytes.length > MAX_TEXT_BYTES) throw new AuthError(400, "Upload a PDF, or a plain text file under 200 KB.");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new AuthError(400, "Upload a PDF, or a plain text file. That file is something else.");
    }
    if (/\u0000/.test(text)) throw new AuthError(400, "Upload a PDF, or a plain text file. That file is something else.");
    input = { text };
  }

  let x: Extraction;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    x = await Promise.race([
      model.extractInvoice(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), READ_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (e instanceof ModelRefusal) return { ok: false, reason: "The reader declined to read this file. You can write the invoice yourself." };
    if (e instanceof Error && e.message === "timeout") return { ok: false, reason: "Reading the file took too long. Try again, or write the invoice yourself." };
    console.error("invoice extraction failed:", e instanceof Error ? e.message : "unknown error");
    return { ok: false, reason: "Couldn't read that file. Try again, or write the invoice yourself." };
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, extraction: x, ...toPrefill(x) };
}

export async function readUpload(model: StewardModel, file: { bytes: Uint8Array; name?: string }): Promise<ReadResult> {
  const result = await readUploadWithExtraction(model, file);
  if (!result.ok) return result;
  return { ok: true, prefill: result.prefill, fromFile: result.fromFile };
}
