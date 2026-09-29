"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { D, E, S, registerMotion } from "@/lib/motion";

/**
 * Children marked data-reveal arrive with the motion system's "arrive" motion, staggered as ledger rows, once on
 * mount. The markup is the finished state, so reduced motion (or no JS) simply shows it.
 */
export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    registerMotion();
    const ctx = gsap.context(() => {
      gsap.from("[data-reveal]", { opacity: 0, y: 12, duration: D.arrive, ease: E("arrive"), stagger: S.row });
    }, ref);
    return () => ctx.revert();
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
