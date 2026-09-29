"use client";

import { useId, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { processImage } from "@/lib/image";

/** Pick a logo or photo: checks it, resizes it, shows the result, lets you remove it (spec §11.6) */
export function ImageUpload({
  label,
  name,
  value,
  onChange,
  mode = "logo",
  letters = 1,
  hint,
}: {
  label: string;
  name: string;
  value?: string | undefined;
  onChange: (url?: string) => void;
  mode?: "logo" | "photo";
  letters?: 1 | 2;
  hint?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const r = await processImage(file, mode);
    setBusy(false);
    if (r.ok) onChange(r.url);
    else setError(r.reason);
    if (input.current) input.current.value = "";
  };

  return (
    <div>
      <p className="text-sm" id={`${id}-label`}>
        {label}
      </p>
      <div className="mt-2 flex items-center gap-4">
        <Avatar name={name} src={value} size={72} letters={letters} />
        <div>
          <div className="flex flex-wrap gap-2">
            <input ref={input} id={id} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-labelledby={`${id}-label`} onChange={(e) => pick(e.target.files?.[0])} />
            <label htmlFor={id} className="cursor-pointer rounded-doc border border-rule px-3.5 py-2 text-sm hover:border-ink focus-within:ring-2 focus-within:ring-seal">
              {busy ? "Processing…" : value ? "Replace" : "Choose an image"}
            </label>
            {value ? (
              <button type="button" onClick={() => onChange(undefined)} className="rounded-doc border border-rule px-3.5 py-2 text-sm hover:border-ink">
                Remove
              </button>
            ) : null}
          </div>
          <p className="mt-2 max-w-[44ch] text-xs text-graphite">{hint ?? "PNG, JPEG or WebP, up to 2 MB. We resize it and remove hidden data such as location."}</p>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
