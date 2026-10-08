import { useId, type ReactNode } from "react";

/** What a control needs to belong to its `Field`: pass these to the `<input>`, `<select>` or `<textarea>` */
export interface FieldAria {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

/** One look for every text input, select and textarea (plan 05zb S3) */
export const controlClass =
  "w-full min-h-11 rounded-doc border border-rule bg-paper px-3 py-2 text-sm text-ink placeholder:text-graphite/70 focus-visible:border-seal disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-red sm:min-h-10";

export const textareaClass = `${controlClass} min-h-24 sm:min-h-24`;

/**
 * A labelled control. Every form field in the app goes through this, so every control has a visible label, a hint in one
 * place and an error in one place, all tied to the control for screen readers. Pass the control as a function:
 * `<Field label="Name">{(a) => <input {...a} className={controlClass} />}</Field>`.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: (aria: FieldAria) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`block ${className}`}>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-medium text-ink">
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-graphite">Optional</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-graphite">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
