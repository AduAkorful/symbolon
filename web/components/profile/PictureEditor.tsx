"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { avatarUrl } from "@/lib/avatar-url";

const SIDE = 256;
const LIMIT = 100 * 1024;

/** Cut the middle square, scale it to 256 px and re-encode: WebP where the browser can, JPEG otherwise, lowering quality until it fits */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file couldn't be read as a picture. Use a JPEG, PNG or WebP.");
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize pictures.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  bitmap.close();
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [0.9, 0.8, 0.65, 0.5]) {
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
      if (blob && blob.type === type && blob.size <= LIMIT) return blob;
    }
  }
  throw new Error("That picture is too big even after resizing. Try a simpler one.");
}

/** Your picture (plan 05zs): shown to teammates and to vendors you do business with; never beside an approval or a payment */
export function PictureEditor({ userId, name, initialVersion }: { userId: string; name: string; initialVersion: number | null }) {
  const [version, setVersion] = useState<number | null>(initialVersion);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const blob = await shrink(file);
      const res = await fetch("/api/profile/avatar", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      const out = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok) throw new Error(out.error ?? "That didn't work. Try again.");
      setVersion(Date.now());
      setDone("Picture updated.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      const res = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!res.ok) throw new Error("That didn't work. Try again.");
      setVersion(null);
      setDone("Picture removed.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Your picture</p>
      <div className="flex items-center gap-4">
        <Avatar name={name} src={avatarUrl(userId, version)} size={56} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {version === null ? "Choose a picture" : "Change picture"}
          </Button>
          {version !== null ? <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={() => void remove()}>Remove</Button> : null}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-label="Choose a picture" onChange={(e) => void choose(e.target.files?.[0])} />
      </div>
      <p className="max-w-[48ch] text-xs text-graphite">Teammates and vendors you do business with can see it. It is never shown next to an approval or a payment.</p>
      {problem ? <p role="alert" className="text-sm text-red">{problem}</p> : null}
      {done ? <p role="status" className="text-sm text-ok">{done}</p> : null}
    </div>
  );
}
