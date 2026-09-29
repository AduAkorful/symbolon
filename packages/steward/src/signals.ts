/**
 * Documents are data (spec §3): text in an invoice is never an instruction. Instruction-like text is a risk signal
 * that forces a human to look; the Steward never follows it.
 */
const PATTERNS: { id: string; re: RegExp }[] = [
  { id: "override", re: /\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|rules?|prompts?)\b/i },
  { id: "role_play", re: /\b(you are now|act as|as an ai|system prompt|assistant:)\b/i },
  { id: "payout_change", re: /\b(new|updated|changed?|different)\b.{0,30}\b(bank|account|wallet|payout|address)\b/i },
  {
    id: "urgency",
    re: /\b(urgent(ly)?|immediately|right away|asap|today only|final notice)\b.{0,40}\b(pay|transfer|send|wire)\b|\b(pay|transfer|send|wire)\b.{0,20}\b(urgent(ly)?|immediately|right away|asap|today)\b/i,
  },
  { id: "approval_claim", re: /\b(pre-?approved|already approved|approved by (the )?(ceo|cfo|owner|finance))\b/i },
  { id: "bypass", re: /\b(skip|bypass|without)\b.{0,20}\b(approval|verification|review|check)s?\b/i },
  { id: "tool_syntax", re: /<\/?(system|instructions?|tool|function)[^>]*>|\{\{.*\}\}/i },
];

export interface Signal {
  id: string;
  field: string;
  excerpt: string;
}

/** Scans every string in a (canonical) invoice document and returns instruction-like passages */
export function scanForInstructions(document: unknown, path = ""): Signal[] {
  if (typeof document === "string") {
    return PATTERNS.flatMap(({ id, re }) => {
      const m = re.exec(document);
      return m ? [{ id, field: path || "(root)", excerpt: document.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20) }] : [];
    });
  }
  if (Array.isArray(document)) return document.flatMap((v, i) => scanForInstructions(v, `${path}[${i}]`));
  if (document && typeof document === "object") {
    return Object.entries(document).flatMap(([k, v]) => scanForInstructions(v, path ? `${path}.${k}` : k));
  }
  return [];
}
