/* eslint-disable @next/next/no-img-element */
/**
 * A person's photo or an organisation's logo, or its initials. `show` is the trust rule (spec §11.6): a vendor's logo is
 * only drawn once the viewer may see it; until then everyone sees initials, so a borrowed logo can't make anything
 * look trusted. The picture is decoration and never the evidence.
 */
export function Avatar({ name, src, show = true, size = 24, letters = 1, className = "" }: { name: string; src?: string | undefined; show?: boolean; size?: number; letters?: 1 | 2; className?: string }) {
  const drawn = Boolean(src) && show;
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, letters)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-sm font-display ${drawn ? "border border-rule bg-paper-raised" : "bg-ink text-paper"} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * (letters === 2 ? 0.42 : 0.52)) }}
      {...(drawn ? { role: "img", "aria-label": `${name}` } : { "aria-hidden": true })}
    >
      {drawn ? <img src={src} alt="" className="h-full w-full object-contain" /> : initials}
    </span>
  );
}
