import Link from "next/link";
import { DemoTag, Wordmark } from "@/components/Marks";
import { Sketch } from "@/components/Sketch";
import { flows } from "@/lib/storyboards";

const seconds = (ms: number) => (ms ? `${(ms / 1000).toFixed(ms % 1000 ? 2 : 0).replace(/0$/, "")} s` : "held");

export default function Storyboards() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1320px] items-center justify-between px-6 pt-7 md:px-10">
        <Link href="/frames">
          <Wordmark />
        </Link>
        <DemoTag />
      </header>

      <main className="mx-auto max-w-[1320px] px-6 pb-24 pt-12 md:px-10">
        <h1 className="font-display text-5xl">Storyboards</h1>
        <p className="mt-3 max-w-[70ch] text-graphite">
          The five flows the video opens with, beat by beat. Dashed arrows are movement. Times are each beat’s motion;
          “held” waits for the person. Each beat’s timing feeds the animatic directly.
        </p>
        <nav aria-label="Flows" className="mt-8 flex flex-wrap gap-2">
          {flows.map((f) => (
            <a key={f.id} href={`#${f.id}`} className="rounded-full border border-rule px-3 py-1 text-sm hover:border-ink">
              {f.name}
            </a>
          ))}
        </nav>

        {flows.map((f) => {
          const total = f.beats.reduce((s, b) => s + b.ms, 0);
          return (
            <section key={f.id} id={f.id} aria-labelledby={`${f.id}-h`} className="mt-16 scroll-mt-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-3">
                <h2 id={`${f.id}-h`} className="font-display text-3xl">
                  {f.name}
                </h2>
                <p className="text-sm text-graphite">
                  Video {f.video} · {f.beats.length} beats · {(total / 1000).toFixed(1)} s of motion
                </p>
              </div>
              <p className="mt-3 max-w-[80ch] text-graphite">{f.intent}</p>

              <ol className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
                {f.beats.map((b, i) => (
                  <li key={b.title}>
                    <Sketch shapes={b.shapes} label={`${f.name}, beat ${i + 1}: ${b.title}`} />
                    <div className="mt-3 flex items-baseline justify-between gap-3">
                      <h3 className="font-medium">
                        <span className="mr-2 font-mono text-xs text-graphite">{i + 1}</span>
                        {b.title}
                      </h3>
                      <span className="font-mono text-xs text-graphite">
                        {b.screen} · {seconds(b.ms)}
                      </span>
                    </div>
                    <dl className="mt-2 space-y-2 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-graphite">On screen</dt>
                        <dd>{b.onScreen}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-seal">Motion</dt>
                        <dd>{b.motion}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-[0.12em] text-graphite">Why</dt>
                        <dd className="text-graphite">{b.why}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </main>
    </div>
  );
}
