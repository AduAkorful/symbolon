"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The logos and photos set in this session (the prototype has no server). Studio Ana's logo, Acme's logo, and people's
 * photos by name. Kept above both apps so a change in one shows in the other.
 */
interface Profile {
  vendorLogo?: string;
  businessLogo?: string;
  photos: Record<string, string>;
  setVendorLogo: (url?: string) => void;
  setBusinessLogo: (url?: string) => void;
  setPhoto: (name: string, url?: string) => void;
  /** A vendor's uploaded logo by name; only Studio Ana has one in the demo */
  logoOf: (vendor: string) => string | undefined;
}

const Ctx = createContext<Profile>({ photos: {}, setVendorLogo: () => {}, setBusinessLogo: () => {}, setPhoto: () => {}, logoOf: () => undefined });

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [vendorLogo, setVendorLogo] = useState<string>();
  const [businessLogo, setBusinessLogo] = useState<string>();
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const setPhoto = useCallback((name: string, url?: string) => {
    setPhotos((p) => {
      const next = { ...p };
      if (url) next[name] = url;
      else delete next[name];
      return next;
    });
  }, []);
  const value = useMemo<Profile>(
    () => ({
      ...(vendorLogo ? { vendorLogo } : {}),
      ...(businessLogo ? { businessLogo } : {}),
      photos,
      setVendorLogo,
      setBusinessLogo,
      setPhoto,
      logoOf: (v) => (v === "Studio Ana" ? vendorLogo : undefined),
    }),
    [vendorLogo, businessLogo, photos, setPhoto],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProfile = () => useContext(Ctx);
