import Link from "next/link";
import { DemoTag, Wordmark } from "@/components/Marks";

const frames = [
  { href: "/frames/invoice", name: "Invoice link page", note: "What a client sees when they open a sealed invoice (P1)" },
  { href: "/frames/home", name: "Business home", note: "Acme's Vault on an ordinary morning (B4)" },
  { href: "/frames/match", name: "The match", note: "Invoice and order meet; the Steward pays (Flow 4)" },
  { href: "/frames/refusal", name: "The refusal", note: "An unsealed 'new wallet' invoice that can’t be paid (Flow 6)" },
];

export default function Frames() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 min-h-screen">
      <div className="flex items-center justify-between">
        <Wordmark />
        <DemoTag />
      </div>
      <h1 className="mt-14 font-display text-5xl">Style frames</h1>
      <p className="mt-3 text-graphite">Direction A, Ledger. Still frames for review; motion comes after approval.</p>
      <ul className="mt-10 border-t border-rule">
        {frames.map((f) => (
          <li key={f.href} className="border-b border-rule">
            <Link href={f.href} className="flex items-baseline justify-between gap-6 py-5 hover:text-seal">
              <span className="font-display text-2xl">{f.name}</span>
              <span className="text-right text-sm text-graphite">{f.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-10">
        <Link href="/b" className="font-display text-2xl underline decoration-rule underline-offset-4 hover:text-seal">
          The prototype: Acme’s business app →
        </Link>
      </p>
      <p className="mt-3">
        <Link href="/storyboards" className="font-display text-2xl underline decoration-rule underline-offset-4 hover:text-seal">
          Storyboards →
        </Link>
      </p>
      <p className="mt-3">
        <Link href="/motion" className="font-display text-2xl underline decoration-rule underline-offset-4 hover:text-seal">
          Motion system →
        </Link>
      </p>
      <p className="mt-3">
        <Link href="/animatic" className="font-display text-2xl underline decoration-rule underline-offset-4 hover:text-seal">
          Animatic →
        </Link>
      </p>
    </main>
  );
}
