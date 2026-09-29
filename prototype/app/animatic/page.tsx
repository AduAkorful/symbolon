import Link from "next/link";
import { Player } from "@/components/animatic/Player";
import { DemoTag, Wordmark } from "@/components/Marks";

export default function Animatic() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[1320px] items-center justify-between px-6 pt-7 md:px-10">
        <Link href="/frames">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-sm text-graphite">
          <Link href="/storyboards" className="hover:text-ink">
            Storyboards
          </Link>
          <Link href="/motion" className="hover:text-ink">
            Motion system
          </Link>
          <DemoTag />
        </nav>
      </header>
      <main className="mx-auto max-w-[1320px] px-6 pb-24 pt-10 md:px-10">
        <h1 className="font-display text-5xl">Animatic</h1>
        <p className="mt-3 max-w-[72ch] text-graphite">
          The storyboards at real speed, using the product’s own components. Judge the rhythm here: what moves, in what
          order, and for how long. Detail and polish come in the full prototype.
        </p>
        <div className="mt-8">
          <Player />
        </div>
      </main>
    </div>
  );
}
