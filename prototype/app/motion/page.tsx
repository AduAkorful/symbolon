import Link from "next/link";
import { DemoTag, Wordmark } from "@/components/Marks";
import { MotionSpecimens } from "@/components/MotionSpecimens";
import { REDUCED } from "@/lib/motion";

const principles = [
  ["Motion carries meaning", "Only changes to money, trust or time move. Nothing animates for its own sake."],
  ["Settlement is instant, so show it instantly", "Arc settles in under a second: payment motion is short and final, never a spinner pretending to work."],
  ["Slow things look slow on purpose", "Cooldowns and queued changes are calm, visible countdowns: safety, not lag."],
  ["The Steward reasons in steps", "Decisions reveal as a sequence: inputs, checks, rule, action. Each number arrives in turn."],
  ["One of each", "One overshoot (the halves closing), one cinematic moment (the refusal). Everything else settles."],
  ["The end state is the design", "Motion runs from a start to the designed screen, so reduced motion simply shows the screen."],
];

export default function Motion() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10">
        <Link href="/frames">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-sm text-graphite">
          <Link href="/storyboards" className="hover:text-ink">
            Storyboards
          </Link>
          <Link href="/animatic" className="hover:text-ink">
            Animatic
          </Link>
          <DemoTag />
        </nav>
      </header>
      <main className="mx-auto max-w-[1180px] px-6 pb-24 pt-10 md:px-10">
        <h1 className="font-display text-5xl">Motion system</h1>
        <p className="mt-3 max-w-[70ch] text-graphite">
          The tokens every animation uses, defined once in <span className="font-mono text-ink">lib/motion.ts</span> and mirrored as
          CSS variables for ordinary transitions.
        </p>

        <section aria-labelledby="principles" className="mt-12">
          <h2 id="principles" className="font-display text-3xl">
            Principles
          </h2>
          <ol className="mt-5 grid gap-x-10 border-t border-ink md:grid-cols-2">
            {principles.map(([t, d]) => (
              <li key={t} className="border-b border-rule py-4">
                <p className="font-medium">{t}</p>
                <p className="mt-1 text-sm text-graphite">{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-16">
          <MotionSpecimens />
        </div>

        <section aria-labelledby="reduced" className="mt-16">
          <h2 id="reduced" className="font-display text-3xl">
            Reduced motion
          </h2>
          <table className="mt-5 w-full border-t border-ink text-sm">
            <tbody>
              {REDUCED.map((r) => (
                <tr key={r.motion} className="border-b border-rule">
                  <td className="py-3 pr-6">{r.motion}</td>
                  <td className="py-3 text-graphite">{r.becomes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}
