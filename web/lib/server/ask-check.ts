import "server-only";

/**
 * Plan 05ze: the check every conversational reply passes before anyone reads it. The model may choose the words; it may not
 * supply a fact. Each number, amount, date, address and name in a reply must appear in what this turn's lookups returned (or in
 * the person's own question); nothing may be a link; the reply may not claim an action. A reply that fails is replaced by the
 * lookups' own sentences, so the person never sees an error and never sees an invented figure.
 */

export type ReplyCheck = { ok: true } | { ok: false; reason: string };

const MAX_REPLY = 900;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const ADDRESS = /0x[0-9a-fA-F]{4,}/g;
const LINK = /https?:\/\/|www\.|\]\(|<\/?[a-z][^>]*>|\bmailto:/i;
/** First-person claims of having done, or being about to do, something Ask cannot do */
const ACTION_CLAIM = /\bI(?:'ve|’ve| have| just| already)?\s+(?:paid|sent|approved|rejected|released|resumed|paused|funded|withdrew|withdrawn|changed|updated|cancel+ed|signed|transferred|scheduled|queued|set)\b|\bI(?:'ll|’ll| will| am going to|'m going to|’m going to)\s+(?:pay|send|approve|reject|release|resume|pause|fund|withdraw|change|update|cancel|sign|transfer|schedule|queue|set)\b/i;
/** Words that are the app's own vocabulary, not a person's or vendor's name, so a capital letter mid-sentence doesn't mean a name */
const OWN_WORDS = new Set(
  ["Symbolon", "Steward", "Vault", "Seal", "USDC", "EURC", "USYC", "Arc", "Early", "Pay", "Treasury", "Approvals", "Inbox", "Vendors", "Orders", "Activity", "Accounting", "Compliance", "Team", "Policy", "Settings", "Home", "Ask", "Verified", "Held", "Paused", "Active", "Reserve", "I", "Ask the Steward"].map((w) => w.toLowerCase()),
);
const SPELLED = new Map<string, string>(
  Object.entries({ zero: "0", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", twenty: "20", thirty: "30", fifty: "50", hundred: "100", thousand: "1000", million: "1000000" }),
);

/** Verdicts the facts do not give ("everything is flowing"): a friendly reply may not add a judgment of its own */
const JUDGMENT = /\b(flowing|healthy|on track|all good|all clear|smoothly|no issues?|nothing to worry|looks? good|looking good|fine|resolved|stable|normal|safe|secure)\b/gi;

const plain = (n: string) => n.replace(/,/g, "");

/** The numbers a text contains, as plain digits ("14,250.50" → "14250.50") */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map(plain));
}

/** Capitalised words that sit mid-sentence: where a name, if the reply has one, would be */
function midSentenceCapitals(reply: string): string[] {
  const found: string[] = [];
  for (const line of reply.split("\n")) {
    const words = line.split(/\s+/).filter(Boolean);
    let startOfSentence = true;
    for (const raw of words) {
      const word = raw.replace(/^[("“'‘]+|[)"”'’.,;:!?]+$/g, "");
      if (!startOfSentence && /^[A-Z][A-Za-z'’-]{2,}$/.test(word) && !/^[A-Z]{2,}$/.test(word)) found.push(word);
      startOfSentence = /[.!?:]["”')]*$/.test(raw);
    }
  }
  return found;
}

/**
 * `facts` are the sentences this turn's lookups produced; `question` is what the person typed. Nothing from earlier replies
 * counts: an earlier reply (which a browser sent back) cannot widen what may be said now.
 */
export function checkReply(reply: string, input: { facts: string[]; question: string }): ReplyCheck {
  const text = reply.trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (text.length > MAX_REPLY) return { ok: false, reason: "too long" };
  if (LINK.test(text)) return { ok: false, reason: "contains a link or markup" };
  if (ACTION_CLAIM.test(text)) return { ok: false, reason: "claims an action" };

  const source = `${input.facts.join("\n")}\n${input.question}`;
  const allowedNumbers = numbersIn(source);
  const lowerSource = source.toLowerCase();

  for (const n of text.match(NUMBER) ?? []) {
    const bare = plain(n).replace(/\.$/, "");
    if (!allowedNumbers.has(bare)) return { ok: false, reason: `a number that is not in the facts: ${n}` };
  }
  // "about 14k", "$1.2M": a magnitude suffix means a rounded or derived figure
  if (/\d\s?[kKmMbB]\b/.test(text)) return { ok: false, reason: "a rounded figure" };

  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const digit = SPELLED.get(word);
    if (digit && !allowedNumbers.has(digit) && !lowerSource.includes(word)) return { ok: false, reason: `a number in words that is not in the facts: ${word}` };
  }

  for (const j of text.match(JUDGMENT) ?? []) {
    if (!lowerSource.includes(j.toLowerCase())) return { ok: false, reason: `a judgment the facts do not make: ${j}` };
  }

  for (const a of text.match(ADDRESS) ?? []) {
    if (!lowerSource.includes(a.toLowerCase())) return { ok: false, reason: `an address that is not in the facts: ${a}` };
  }

  for (const word of midSentenceCapitals(text)) {
    const lower = word.toLowerCase().replace(/['’]s$/, "");
    if (OWN_WORDS.has(lower) || lowerSource.includes(lower)) continue;
    return { ok: false, reason: `a name that is not in the facts: ${word}` };
  }
  return { ok: true };
}
