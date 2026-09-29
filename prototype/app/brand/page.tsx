import { Mark, Wordmark } from "@/components/Marks";
import { PublicHeader } from "@/components/public/PublicHeader";
import { MARK } from "@/lib/brand";

const files = [
  ["Logo, horizontal", "symbolon-logo.svg", "Mark and name, outlined type. The default lockup."],
  ["Logo, stacked", "symbolon-logo-stacked.svg", "For square spaces and covers."],
];

const swatches = [
  ["Ink", "#15211C", "The left half. Text."],
  ["Seal", "#2B3A8C", "The right half. Sealed, verified."],
  ["Paper", "#E8EDE2", "The page."],
  ["Ink, at night", "#E4EBE0", "Left half on dark."],
  ["Seal, at night", "#9FB0F5", "Right half on dark."],
  ["Night", "#131A16", "The dark page."],
];

/** The logo system: the mark, its lockups, small sizes, colours and downloads */
export default function Brand() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-[1100px] px-6 pb-28 pt-14 md:px-10">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-seal">Brand</p>
        <h1 className="mt-3 font-display text-[clamp(2.8rem,6vw,4.6rem)] leading-none">The logo</h1>
        <p className="mt-4 max-w-[62ch] text-graphite">
          Two halves of a document, cut along the same wavy seam every invoice carries. The left is ink, the right is seal blue; the hairline between
          them is the fit. The cut is the seam the product draws for invoice 0143, so the logo is a real fingerprint’s edge, not a decoration.
        </p>

        <section className="mt-12 grid gap-4 md:grid-cols-3" aria-label="The mark on paper, night and seal">
          <div className="grid h-72 place-items-center rounded-doc border border-rule bg-paper">
            <Mark className="h-44 w-auto" />
          </div>
          <div data-theme="dark" className="grid h-72 place-items-center rounded-doc border border-rule bg-[#131a16]">
            <svg viewBox="0 0 92 116" className="h-44 w-auto" aria-hidden>
              <Halves left="#E4EBE0" right="#9FB0F5" />
            </svg>
          </div>
          <div className="grid h-72 place-items-center rounded-doc bg-[#2B3A8C]">
            <svg viewBox="0 0 92 116" className="h-44 w-auto" aria-hidden>
              <Halves left="#F1F4EC" right="#F1F4EC" />
            </svg>
          </div>
        </section>

        <section className="mt-16" aria-labelledby="lockups">
          <h2 id="lockups" className="font-display text-3xl">
            Lockups
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-[1.6fr_1fr]">
            <div className="grid h-56 place-items-center rounded-doc border border-rule bg-paper-raised">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/symbolon-logo.svg" alt="Symbolon, horizontal logo" className="h-20 w-auto" />
            </div>
            <div className="grid h-56 place-items-center rounded-doc border border-rule bg-paper-raised">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/symbolon-logo-stacked.svg" alt="Symbolon, stacked logo" className="h-40 w-auto" />
            </div>
          </div>
          <p className="mt-4 text-sm text-graphite">In the app the lockup is live type: <Wordmark className="ml-2 align-middle" /></p>
        </section>

        <section className="mt-16" aria-labelledby="small">
          <h2 id="small" className="font-display text-3xl">
            Small sizes
          </h2>
          <p className="mt-2 max-w-[62ch] text-sm text-graphite">Below 48 px the hairline is widened so the two halves still read as two. These are the real favicon sizes.</p>
          <div className="mt-5 flex flex-wrap items-end gap-8 rounded-doc border border-rule bg-paper-raised p-8">
            {[16, 24, 32, 48, 96].map((px) => (
              <figure key={px} className="text-center">
                <span className="mx-auto block w-fit" style={{ height: px }}>
                  <Mark small={px < 48} className="h-full w-auto" />
                </span>
                <figcaption className="mt-3 font-mono text-[11px] text-graphite">{px} px</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="mt-16" aria-labelledby="colours">
          <h2 id="colours" className="font-display text-3xl">
            Colours
          </h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {swatches.map(([name, hex, use]) => (
              <li key={name}>
                <div className="h-16 rounded-doc border border-rule" style={{ background: hex }} />
                <p className="mt-2 text-sm font-medium">{name}</p>
                <p className="font-mono text-xs text-graphite">{hex}</p>
                <p className="mt-0.5 text-xs text-graphite">{use}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="rules">
          <h2 id="rules" className="font-display text-3xl">
            Using it
          </h2>
          <ul className="mt-4 max-w-[70ch] list-disc space-y-1.5 pl-5 text-sm">
            <li>Keep clear space equal to half the mark’s width on every side.</li>
            <li>Smallest sizes: the mark 16 px, the horizontal logo 96 px wide.</li>
            <li>On dark backgrounds use the night version; on a photograph or a single-ink job use the one-colour version.</li>
            <li>Don’t recolour the halves, swap them, straighten the seam, add effects, or set the name in another typeface.</li>
            <li>The mark alone can stand for Symbolon in a favicon, an app icon or a profile picture; the name doesn’t need to sit beside it there.</li>
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="files">
          <h2 id="files" className="font-display text-3xl">
            Files
          </h2>
          <ul className="mt-4 border-t border-ink">
            {files.map(([name, file, note]) => (
              <li key={file} className="grid gap-1 border-b border-rule py-3 text-sm sm:grid-cols-[16rem_1fr_auto] sm:items-baseline sm:gap-4">
                <span className="font-medium">{name}</span>
                <span className="text-graphite">{note}</span>
                <a href={`/brand/${file}`} download className="font-mono text-xs underline decoration-rule underline-offset-4 hover:decoration-ink">
                  {file}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}


function Halves({ left, right }: { left: string; right: string }) {
  return (
    <>
      <path d={MARK.left} fill={left} />
      <path d={MARK.right} fill={right} />
    </>
  );
}
