import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "destructive";
export type ButtonSize = "md" | "sm";

const base =
  "items-center justify-center gap-2 whitespace-nowrap rounded-doc font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  secondary: "border border-rule text-ink hover:border-ink/60",
  quiet: "text-graphite hover:text-ink",
  danger: "border border-red/50 text-red hover:bg-red-wash",
  // the button that does the irreversible thing, once the person has been told what it does
  destructive: "bg-red text-paper hover:bg-red/90",
};

// 44 px on a phone (the touch minimum for the actions that matter), 40 and 36 px with a mouse
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-sm sm:min-h-10",
  sm: "min-h-11 px-3 text-sm sm:min-h-9",
};

/**
 * The one set of button styles (plan 05zb S2). Use it as a class on whatever element the action needs (`<button>`, a
 * `<Link>`, a submit input) or through `Button` / `LinkButton`. Layout classes (`w-full`, `flex-1`, margins) go in `className`
 * on top; colour, padding, height and type size never do.
 */
export function buttonClass({ variant = "primary", size = "md", className = "" }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  // a caller that hides the button below a width passes `hidden sm:inline-flex`; a second display class here would fight it
  const display = /(?:^|\s)hidden(?:\s|$)/.test(className) ? "" : "inline-flex";
  return `${display} ${base} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim();
}

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className = "",
  type = "button",
  disabled,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; busy?: boolean; children: ReactNode }) {
  return (
    <button type={type} disabled={disabled || busy} aria-busy={busy || undefined} className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </button>
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string; variant?: ButtonVariant; size?: ButtonSize; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </Link>
  );
}
