import { notesBlocks } from "@/lib/release-notes";

/** `code` spans drawn as code and **bold** as bold, the rest as text (plan 05zj G, SYM-47: the asterisks used to show) */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="font-mono text-[0.92em] text-ink">{part.slice(1, -1)}</code>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Verified release notes as paragraphs and bullets (the text is already free of internal plan references; see lib/release-notes.ts) */
export function ReleaseNotesBody({ notes }: { notes: string }) {
  return (
    <div className="space-y-3">
      {notesBlocks(notes).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}><Inline text={block.text} /></p>
        ) : (
          <ul key={i} className="list-disc space-y-2 pl-5">
            {block.items.map((item) => <li key={item}><Inline text={item} /></li>)}
          </ul>
        ),
      )}
    </div>
  );
}
