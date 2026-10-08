import type { Tone } from "@/components/ui/StatusPill";

/** The text-tone names `business-status` and `invoice-status` use, as the `StatusPill` tones they are drawn with */
export const pillTone: Record<"ink" | "seal" | "red" | "graphite", Tone> = { ink: "neutral", seal: "ok", red: "danger", graphite: "neutral" };
