import { notesBlocks } from "@/lib/release-notes";

/** `code` spans in the notes drawn as code, the rest as text */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? <code key={i} className="font-mono text-[0.92em] text-ink">{part}</code> : <span key={i}>{part}</span>,
      )}
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
