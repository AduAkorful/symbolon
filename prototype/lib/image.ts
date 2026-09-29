/**
 * Logo and photo uploads (spec §11.6), done here in the browser the way the real service will do them: refuse what
 * isn't a safe raster image, limit the size, then re-encode and resize, which drops any hidden data (location, camera).
 */
export const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export type Processed = { ok: true; url: string } | { ok: false; reason: string };

export async function processImage(file: File, mode: "logo" | "photo"): Promise<Processed> {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return { ok: false, reason: "SVG isn’t accepted, because it can carry script. Use a PNG, JPEG or WebP." };
  if (!ACCEPTED.includes(file.type)) return { ok: false, reason: "That isn’t a PNG, JPEG or WebP image." };
  if (file.size > MAX_BYTES) return { ok: false, reason: `That’s ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.` };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "We couldn’t read that image. Try another file." };
  }
  if (bitmap.width < 64 || bitmap.height < 64) return { ok: false, reason: "That’s too small. Use at least 64 × 64 pixels." };
  const size = mode === "photo" ? 384 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "We couldn’t process that image in this browser." };
  // A photo fills the square (centre crop); a logo fits inside it, whole, on a transparent square
  const k = mode === "photo" ? Math.max(size / bitmap.width, size / bitmap.height) : Math.min(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * k;
  const h = bitmap.height * k;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  return { ok: true, url: canvas.toDataURL(mode === "photo" ? "image/jpeg" : "image/png", 0.86) };
}
