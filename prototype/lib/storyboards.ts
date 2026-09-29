import type { Shape } from "@/components/Sketch";

/**
 * Storyboards for the five priority flows (brief 05b §6), beat by beat. This file is the source for the animatic:
 * each beat's duration becomes a timeline segment, so storyboard and animatic can't drift apart.
 */

export interface Beat {
  title: string;
  /** Screen from the brief (P1, B6, V8 …) */
  screen: string;
  /** Length of the beat's motion in milliseconds; 0 = a held state, waits for the person */
  ms: number;
  onScreen: string;
  motion: string;
  why: string;
  shapes: Shape[];
}

export interface Flow {
  id: string;
  name: string;
  /** Where it sits in the 3-minute video (spec §20) */
  video: string;
  intent: string;
  beats: Beat[];
}

// Reused pieces
const inboxRows = (y0: number): Shape[] => [
  { t: "rows", x: 14, y: y0, w: 132, n: 5, gap: 10 },
  { t: "text", x: 14, y: 14, s: "Inbox", size: 6, serif: true },
];
const vendorDoc = (x: number, y = 16, w = 60, h = 70, tone: "ink" | "seal" | "red" | "ghost" = "ink"): Shape[] => [
  { t: "doc", x, y, w, h, cut: "r", tone },
  { t: "rows", x: x + 6, y: y + 24, w: w - 16, n: 6, gap: 6 },
  { t: "text", x: x + 6, y: y + 10, s: "Studio Ana", size: 5.5, serif: true },
];
const payerDoc = (x: number, y = 16, w = 60, h = 70, tone: "ink" | "seal" | "red" | "ghost" = "ink"): Shape[] => [
  { t: "doc", x, y, w, h, cut: "l", tone },
  { t: "rows", x: x + 10, y: y + 24, w: w - 16, n: 6, gap: 6 },
  { t: "text", x: x + 10, y: y + 10, s: "Acme", size: 5.5, serif: true },
];

export const flows: Flow[] = [
  {
    id: "fraud",
    name: "The fraud",
    video: "0:00–0:25",
    intent: "A convincing “new wallet” email arrives. Show that it can’t be paid, and why, before anyone has to think.",
    beats: [
      {
        title: "It arrives",
        screen: "B5",
        ms: 420,
        onScreen: "Inbox. A new row appears at the top: “Studio Ana — invoice #0150”, tagged Unsigned in pencil.",
        motion: "Row slides down from under the header; the rows below shift one line. No bounce.",
        why: "Arrivals are ordinary. The drama comes from what the product does next, not from the arrival.",
        shapes: [
          ...inboxRows(30),
          { t: "bar", x: 14, y: 22, w: 132, h: 7, tone: "red", outline: true },
          { t: "text", x: 17, y: 27, s: "Studio Ana · #0150", size: 4.2 },
          { t: "text", x: 143, y: 27, s: "Unsigned", size: 3.8, tone: "red", anchor: "end" },
          { t: "arrow", x1: 80, y1: 10, x2: 80, y2: 20 },
        ],
      },
      {
        title: "The Steward reads it",
        screen: "B7",
        ms: 900,
        onScreen: "The row opens into the document. Extracted fields fill in one by one; “Pay today to avoid late fees” is underlined in red.",
        motion: "Fields type in with a 60 ms stagger. The underline draws left to right after the last field.",
        why: "Documents are data. Showing the read, and flagging the instruction-like line, makes that visible.",
        shapes: [
          { t: "doc", x: 20, y: 12, w: 70, h: 78, tone: "red" },
          { t: "text", x: 26, y: 22, s: "Studio Ana?", size: 5.5, serif: true },
          { t: "rows", x: 26, y: 36, w: 56, n: 5, gap: 7 },
          { t: "text", x: 26, y: 74, s: "Pay today…", size: 4, tone: "red" },
          { t: "line", x1: 26, y1: 76, x2: 56, y2: 76, tone: "red" },
          { t: "text", x: 100, y: 30, s: "no Seal", size: 4.5, tone: "red" },
          { t: "text", x: 100, y: 40, s: "new address", size: 4.5, tone: "red" },
          { t: "text", x: 100, y: 50, s: "look-alike domain", size: 4.5, tone: "red" },
        ],
      },
      {
        title: "It tries to fit",
        screen: "B7",
        ms: 700,
        onScreen: "The unsigned document slides toward Acme’s half for Studio Ana. The edges approach and stop short: they don’t match.",
        motion: "Slide in on a decelerating ease, stop 6 px apart. The two edge lines turn red. No shake.",
        why: "The signature idea in reverse: only the true pair fits. The eye sees the mismatch before reading a word.",
        shapes: [...vendorDoc(20, 16, 58, 70, "red"), ...payerDoc(88, 16, 56, 70, "ghost"), { t: "arrow", x1: 40, y1: 92, x2: 62, y2: 92, tone: "red" }],
      },
      {
        title: "It comes apart",
        screen: "B7",
        ms: 900,
        onScreen: "The letters along the fake’s cut break into fragments and drift into the gap, fading.",
        motion: "Particle break-up (borrowed from direction C): letters loosen from the bottom up, drift right and down, fade over 900 ms.",
        why: "A physical metaphor for “this has no fingerprint”. The one cinematic moment in the flow.",
        shapes: [...vendorDoc(16, 16, 58, 70, "red"), { t: "scatter", x: 76, y: 30, w: 26, h: 50 }, ...payerDoc(100, 16, 50, 70, "ghost")],
      },
      {
        title: "This can’t be paid",
        screen: "B7",
        ms: 800,
        onScreen: "Headline “This can’t be paid.” Four reasons as ledger lines with red crosses.",
        motion: "Headline resolves from blur to sharp (500 ms). Reasons follow, 90 ms apart, each cross drawing its two strokes.",
        why: "The explanation lands in reading order. Calm red, never an alarm.",
        shapes: [
          { t: "text", x: 14, y: 22, s: "This can’t be paid.", size: 10, serif: true },
          { t: "rows", x: 14, y: 38, w: 132, n: 5, gap: 11 },
          { t: "tick", x: 18, y: 33, cross: true },
          { t: "tick", x: 18, y: 44, cross: true },
          { t: "tick", x: 18, y: 55, cross: true },
          { t: "tick", x: 18, y: 66, cross: true },
        ],
      },
      {
        title: "Warn the vendor",
        screen: "B7",
        ms: 0,
        onScreen: "Actions: Warn Studio Ana, Mark as fraud, Ask for a sealed invoice. After warning, a ledger line: “Studio Ana warned, 10:06”.",
        motion: "Held state. On press, the button fills, then the confirmation line writes in beneath.",
        why: "Ends on a thing the owner does, and a record that it happened.",
        shapes: [
          { t: "btn", x: 14, y: 30, w: 40, s: "Warn Studio Ana", filled: true },
          { t: "btn", x: 58, y: 30, w: 38, s: "Mark as fraud", tone: "red" },
          { t: "btn", x: 100, y: 30, w: 46, s: "Ask for sealed invoice" },
          { t: "line", x1: 14, y1: 52, x2: 146, y2: 52, tone: "ghost" },
          { t: "text", x: 14, y: 50, s: "10:06  Studio Ana warned", size: 4.5 },
        ],
      },
    ],
  },
  {
    id: "seal-and-join",
    name: "Seal and send; the client joins",
    video: "0:25–1:05",
    intent: "A freelancer seals an invoice in seconds; the client opens it, sets up, and verifies the vendor.",
    beats: [
      {
        title: "Compose",
        screen: "V4",
        ms: 0,
        onScreen: "Composer: three line items, the total, the Early Pay curve (1.5% in 3 days, 0.75% in 15).",
        motion: "Each amount rolls to its new value as it’s typed (digits roll, 180 ms). The total rolls last. Curve tiers appear as stepped blocks.",
        why: "Numbers that roll feel computed, not typed. The curve is the vendor’s choice, so it’s visible.",
        shapes: [
          ...vendorDoc(16, 12, 78, 78),
          { t: "text", x: 88, y: 84, s: "2,400.00", size: 6, anchor: "end", serif: true },
          { t: "bar", x: 104, y: 60, w: 12, h: 26, tone: "seal", outline: true },
          { t: "bar", x: 118, y: 70, w: 12, h: 16, tone: "seal", outline: true },
          { t: "bar", x: 132, y: 78, w: 12, h: 8, tone: "ghost", outline: true },
        ],
      },
      {
        title: "Seal",
        screen: "V6",
        ms: 1100,
        onScreen: "Signing sheet: “You’re signing invoice 0142 for 2,400.00 USDC to Acme.” Sign. The Seal strikes; the edge is cut.",
        motion: "Sheet rises (300 ms). On sign: the stamp strikes (scale 1.12 → 1, 160 ms, ink spreads), then the right edge is cut top to bottom along the fingerprint while its letters write in (600 ms).",
        why: "The core metaphor made physical: sealing is what makes it one half of a pair.",
        shapes: [...vendorDoc(30, 12, 80, 78), { t: "stamp", x: 96, y: 26, r: 7 }, { t: "arrow", x1: 116, y1: 16, x2: 116, y2: 86 }],
      },
      {
        title: "Sent",
        screen: "V3",
        ms: 500,
        onScreen: "Copy link, QR, or email. The invoice list shows 0142: “Sent · not yet viewed”.",
        motion: "The document scales down into its row in the list (shared-element move, 500 ms).",
        why: "Continuity: the thing the vendor sealed is the thing in the list.",
        shapes: [
          { t: "doc", x: 60, y: 8, w: 30, h: 36, cut: "r" },
          { t: "arrow", x1: 75, y1: 46, x2: 40, y2: 64 },
          { t: "rows", x: 14, y: 70, w: 132, n: 3, gap: 9 },
          { t: "text", x: 16, y: 68, s: "0142 · Sent · not yet viewed", size: 4.2 },
        ],
      },
      {
        title: "The client opens it",
        screen: "P1",
        ms: 900,
        onScreen: "The invoice link page: headline, the sealed half, and an empty other half with Pay and Set up.",
        motion: "Headline resolves from blur (500 ms). The sealed half slides in from the left; the empty half’s dotted edge draws beside it.",
        why: "The client sees one half and the space for theirs: the product explains itself.",
        shapes: [{ t: "text", x: 14, y: 14, s: "Studio Ana sent you an invoice", size: 6, serif: true }, ...vendorDoc(14, 20, 76, 72), ...payerDoc(84, 20, 62, 72, "ghost")],
      },
      {
        title: "Set up the business",
        screen: "B1–B3",
        ms: 0,
        onScreen: "Three steps: create the Vault (address appears), fund it (balance counts up), pick a template.",
        motion: "Steps advance on a horizontal track; the Vault address resolves character by character; the balance counts up to the deposit.",
        why: "Onboarding feels like progress, not a form.",
        shapes: [
          { t: "line", x1: 20, y1: 30, x2: 140, y2: 30, tone: "ghost" },
          { t: "tick", x: 30, y: 30 },
          { t: "tick", x: 80, y: 30 },
          { t: "stamp", x: 130, y: 30, r: 3.5, tone: "ghost" },
          { t: "text", x: 20, y: 52, s: "Vault 0x7a3f…c219", size: 5 },
          { t: "text", x: 20, y: 72, s: "10,000.00", size: 10, serif: true },
        ],
      },
      {
        title: "Verify Studio Ana",
        screen: "B9",
        ms: 600,
        onScreen: "A one-time code exchanged on another channel. When both sides enter it, the badge changes from “new” to Verified.",
        motion: "The code’s digits settle one by one; the badge flips (rotateX, 400 ms) from pencil to signature ink.",
        why: "Trust is established once, deliberately, and the change of state is visible.",
        shapes: [
          { t: "text", x: 80, y: 40, s: "4 1 7 · 9 2 0", size: 10, anchor: "middle", tone: "ink" },
          { t: "stamp", x: 80, y: 70, word: "VERIFIED" },
        ],
      },
    ],
  },
  {
    id: "steward-pays",
    name: "The Steward pays, with Early Pay",
    video: "1:05–1:50",
    intent: "A retainer invoice matches its order and delivery; the Steward weighs the discount and pays.",
    beats: [
      {
        title: "The retainer arrives",
        screen: "B5",
        ms: 420,
        onScreen: "Inbox: “Studio Ana · 0143 · Verified”, released from the series the studio sealed up front.",
        motion: "Row slides in (same as every arrival). A small Seal mark sits on it.",
        why: "Routine things stay routine.",
        shapes: [...inboxRows(30), { t: "bar", x: 14, y: 22, w: 132, h: 7, tone: "seal", outline: true }, { t: "text", x: 17, y: 27, s: "Studio Ana · 0143 · Verified", size: 4.2 }],
      },
      {
        title: "Acme’s half assembles",
        screen: "B6",
        ms: 800,
        onScreen: "Beside the invoice, Acme’s half builds from its parts: PO-0031, the Linear sign-off, the budget.",
        motion: "Three lines fly in from the right and stack into a half-document (80 ms stagger), then its left edge is cut.",
        why: "The payer’s half isn’t a form; it’s evidence gathered from the order and the delivery.",
        shapes: [...vendorDoc(14, 16, 60, 70), { t: "doc", x: 92, y: 16, w: 54, h: 70, cut: "l", tone: "ghost" }, { t: "arrow", x1: 150, y1: 30, x2: 120, y2: 34 }, { t: "arrow", x1: 150, y1: 50, x2: 120, y2: 50 }, { t: "arrow", x1: 150, y1: 70, x2: 120, y2: 66 }],
      },
      {
        title: "The match",
        screen: "B6",
        ms: 700,
        onScreen: "The halves slide together and close. The seam letters line up. MATCHED is stamped across the seam.",
        motion: "Both halves move toward the centre (600 ms, strong ease-out), close with a 2 px overshoot and settle (100 ms). The stamp strikes 120 ms later.",
        why: "The product’s name, in one motion. This is the frame people remember.",
        shapes: [...vendorDoc(21, 16, 60, 70, "seal"), ...payerDoc(77, 16, 60, 70, "seal"), { t: "stamp", x: 79, y: 40, word: "MATCHED" }],
      },
      {
        title: "The Steward checks",
        screen: "B6",
        ms: 900,
        onScreen: "Seven rules as ledger lines, each with a blue tick: sealed, PO, delivery, limit, budget, never paid, worth paying early.",
        motion: "Lines write in 90 ms apart; each tick draws after its line. Reads like a clerk initialling a page.",
        why: "“The model suggests; the contract decides”, shown as a sequence of checks, not a confidence score.",
        shapes: [{ t: "rows", x: 22, y: 20, w: 124, n: 8, gap: 9 }, ...[0, 1, 2, 3, 4, 5, 6].map((i): Shape => ({ t: "tick", x: 16, y: 16 + i * 9 }))],
      },
      {
        title: "Worth paying early?",
        screen: "B6",
        ms: 700,
        onScreen: "Two bars: 9.1% a year (the discount) against 6.2% (reserve 3.2% + 3 points). Verdict: pay now.",
        motion: "Bars grow from zero together (500 ms); the threshold line drops in; the verdict appears when the first bar passes it.",
        why: "The one real decision the Steward makes here, in numbers anyone can check.",
        shapes: [
          { t: "bar", x: 30, y: 30, w: 30, h: 50, tone: "seal" },
          { t: "bar", x: 90, y: 50, w: 30, h: 30, tone: "ghost", outline: true },
          { t: "line", x1: 20, y1: 46, x2: 140, y2: 46, tone: "ink", dash: true },
          { t: "text", x: 45, y: 26, s: "9.1%", size: 6, anchor: "middle" },
          { t: "text", x: 105, y: 46, s: "6.2%", size: 5, anchor: "middle", tone: "ghost" },
        ],
      },
      {
        title: "Paid",
        screen: "B6 → B4",
        ms: 900,
        onScreen: "“Paid 1,985.00 USDC · settled in 0.6 s”. On Home, a new line in the Steward’s ledger.",
        motion: "The amount counts down from 2,000.00 to 1,985.00 (600 ms) as the discount applies; the ledger line inserts at the top of Home.",
        why: "Arc settles in under a second, so the payment animation is short and final.",
        shapes: [{ t: "text", x: 14, y: 40, s: "Paid 1,985.00", size: 14, serif: true }, { t: "text", x: 14, y: 52, s: "settled in 0.6 s", size: 5, tone: "ghost" }, { t: "rows", x: 14, y: 70, w: 132, n: 3, gap: 8 }],
      },
    ],
  },
  {
    id: "paid-today",
    name: "Get paid today",
    video: "1:50–2:20",
    intent: "An agency asks for cash now; the Steward redeems from reserve and an approver signs on their phone.",
    beats: [
      {
        title: "Ask",
        screen: "V7 (phone)",
        ms: 0,
        onScreen: "Vendor’s phone: invoice 2291, 9,000.00 due in 25 days. Button: Get paid today.",
        motion: "Held state. The button has a quiet shimmer of the seal colour on first view only.",
        why: "Early Pay is always the vendor’s choice, so it starts on their side.",
        shapes: [{ t: "phone", x: 58, y: 8 }, { t: "text", x: 64, y: 24, s: "2291", size: 5, serif: true }, { t: "text", x: 64, y: 40, s: "9,000.00", size: 8, serif: true }, { t: "btn", x: 63, y: 72, w: 34, s: "Get paid today", filled: true }],
      },
      {
        title: "Choose a discount",
        screen: "V8 (phone)",
        ms: 0,
        onScreen: "A slider from 0 to 3%, with a marker for what’s been accepted before. Below it, exactly what they’ll receive: 8,892.00.",
        motion: "Dragging updates the amount live (digits roll). The marker is a soft band, not a snap point.",
        why: "“Vendors always see exactly what they receive before accepting.”",
        shapes: [{ t: "phone", x: 58, y: 8 }, { t: "line", x1: 64, y1: 40, x2: 96, y2: 40, tone: "ghost" }, { t: "stamp", x: 78, y: 40, r: 2.5 }, { t: "bar", x: 74, y: 37, w: 10, h: 6, tone: "seal", outline: true }, { t: "text", x: 64, y: 58, s: "8,892.00", size: 8, serif: true }, { t: "btn", x: 63, y: 72, w: 34, s: "Sign offer", filled: true }],
      },
      {
        title: "The approver is asked",
        screen: "C1 / B13 (phone)",
        ms: 500,
        onScreen: "Approver’s phone: “Recommend accepting: pay 8,892 now instead of 9,000 in 25 days. Needs 5,000 from reserve. Runway after: 52 days.”",
        motion: "Card rises from the bottom (500 ms). Numbers in the recommendation roll in last.",
        why: "One tap, but with the reasoning and the rule that required a human.",
        shapes: [{ t: "phone", x: 58, y: 8 }, { t: "doc", x: 62, y: 40, w: 36, h: 40, tone: "seal" }, { t: "rows", x: 65, y: 52, w: 30, n: 4, gap: 5 }, { t: "arrow", x1: 80, y1: 96, x2: 80, y2: 84 }],
      },
      {
        title: "Sign; reserve moves",
        screen: "B15",
        ms: 900,
        onScreen: "Approver signs. 5,000 moves from reserve to operating; then the payment goes out.",
        motion: "A band of blue flows from the reserve bar into the operating bar (600 ms), then the operating bar steps down by 8,892.",
        why: "Two money movements, in order, each visible. Nothing happens off-screen.",
        shapes: [{ t: "bar", x: 30, y: 30, w: 26, h: 50, tone: "seal", outline: true }, { t: "bar", x: 100, y: 40, w: 26, h: 40, tone: "ink", outline: true }, { t: "arrow", x1: 58, y1: 44, x2: 98, y2: 50 }, { t: "text", x: 43, y: 88, s: "Reserve", size: 4.5, anchor: "middle", tone: "ghost" }, { t: "text", x: 113, y: 88, s: "Operating", size: 4.5, anchor: "middle", tone: "ghost" }],
      },
      {
        title: "Paid today",
        screen: "V7 (phone)",
        ms: 700,
        onScreen: "Vendor’s phone: “Paid 8,892.00”, with the receipt: original 9,000.00, discount 1.2%, paid today.",
        motion: "The amount lands with a single settle; the receipt unfolds beneath (height auto, 400 ms).",
        why: "Minutes from asking to paid is the vendor’s whole story.",
        shapes: [{ t: "phone", x: 58, y: 8 }, { t: "text", x: 64, y: 34, s: "Paid", size: 6, serif: true }, { t: "text", x: 64, y: 46, s: "8,892.00", size: 8, serif: true }, { t: "rows", x: 64, y: 58, w: 32, n: 3, gap: 6 }, { t: "tick", x: 92, y: 30 }],
      },
    ],
  },
  {
    id: "guardrails",
    name: "The guardrails",
    video: "2:20–2:45",
    intent: "Three quick proofs that limits hold: a retry refused, an over-limit escalated, a pause that stops everything.",
    beats: [
      {
        title: "A retry, refused",
        screen: "B17",
        ms: 500,
        onScreen: "Ledger line: “Retry of 0143 refused by the Vault: already paid.”",
        motion: "The line writes in; a red rule strikes through the attempted amount (300 ms).",
        why: "Pay-once is enforced by the contract; the record shows the refusal.",
        shapes: [{ t: "rows", x: 14, y: 30, w: 132, n: 4, gap: 10 }, { t: "text", x: 16, y: 28, s: "Retry of 0143 · already paid", size: 4.5 }, { t: "text", x: 144, y: 28, s: "1,985.00", size: 4.5, anchor: "end" }, { t: "line", x1: 124, y1: 26.5, x2: 145, y2: 26.5, tone: "red" }],
      },
      {
        title: "Over the limit",
        screen: "B4",
        ms: 600,
        onScreen: "A 14,000 hardware invoice moves from the Steward’s ledger into “Needs you”, with the rule: owner above 10,000.",
        motion: "The card lifts out of the ledger column and settles into the Needs-you column (shared-element move, 600 ms).",
        why: "Escalation by policy, shown as the work literally moving to a person.",
        shapes: [{ t: "rows", x: 90, y: 20, w: 56, n: 7, gap: 9 }, { t: "doc", x: 14, y: 20, w: 60, h: 26, tone: "red" }, { t: "arrow", x1: 92, y1: 34, x2: 76, y2: 33 }, { t: "text", x: 18, y: 30, s: "14,000.00 · owner", size: 4.2 }],
      },
      {
        title: "Pause",
        screen: "Any",
        ms: 500,
        onScreen: "Owner presses Pause payments. Everything scheduled shows Paused; the Steward chip reads Paused; a red rule runs across the top.",
        motion: "The red rule draws across the top edge (400 ms); the rest of the app desaturates slightly; scheduled amounts get a pencil “paused” tag.",
        why: "One action, instant, unmistakable, in every mode.",
        shapes: [{ t: "line", x1: 0, y1: 4, x2: 160, y2: 4, tone: "red", w: 2 }, { t: "btn", x: 104, y: 12, w: 42, s: "Resume payments", tone: "red" }, { t: "rows", x: 14, y: 36, w: 132, n: 5, gap: 10, tone: "ghost" }, { t: "text", x: 14, y: 26, s: "Payments paused", size: 7, serif: true, tone: "red" }],
      },
    ],
  },
];
