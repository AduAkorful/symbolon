/**
 * Release notes as people should read them (plan 05zc §1). The text a release's hash commits to is never changed: this only
 * decides what to draw. The first two testnet releases name the internal plan files they came from ("plans 01, 01a, 01b",
 * "plan 04"); those references mean nothing to a customer, so the parenthetical is left out of what is shown, and the page says
 * so. Everything else, word for word, is what was published.
 */
const PLAN_REFERENCE = /\s*\((?:plans?\s+[0-9]+[a-z]?(?:\s*(?:,|and|&)\s*[0-9]+[a-z]?)*)\)/gi;

export interface ShownNotes {
  /** What to draw */
  text: string;
  /** True when internal plan references were left out of `text` */
  trimmed: boolean;
}

export function displayReleaseNotes(published: string): ShownNotes {
  const text = published.replace(PLAN_REFERENCE, "");
  return { text, trimmed: text !== published };
}

export type NotesBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** The notes as paragraphs and bullet lists, without the leading "# …" title (the page already names the release) */
export function notesBlocks(text: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  const body = text.replace(/^#[^\n]*\n+/, "");
  for (const chunk of body.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines[0]!.startsWith("- ")) {
      const items: string[] = [];
      for (const line of lines) {
        if (line.startsWith("- ")) items.push(line.slice(2).trim());
        else items[items.length - 1] += ` ${line.trim()}`;
      }
      blocks.push({ kind: "list", items });
    } else {
      blocks.push({ kind: "paragraph", text: lines.map((l) => l.trim()).join(" ") });
    }
  }
  return blocks;
}
