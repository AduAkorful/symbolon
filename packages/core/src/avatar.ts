/**
 * Profile picture validation (plan 05zs). The browser resizes, but the server never trusts that: the type is decided from the
 * bytes, the size and dimensions are bounded, and anything that isn't a plain JPEG, PNG or WebP is refused. SVG, GIF and
 * files with extra data after the image's end are refused, so what is stored is exactly an image and nothing else.
 */
export const AVATAR_MAX_BYTES = 100 * 1024;
export const AVATAR_MAX_SIDE = 512;
export type AvatarType = "image/jpeg" | "image/png" | "image/webp";
export type AvatarCheck = { ok: true; type: AvatarType; width: number; height: number } | { ok: false; reason: string };

const NOT_AN_IMAGE = "Only JPEG, PNG or WebP pictures can be used.";
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));

function png(b: Uint8Array): AvatarCheck {
  if (b.length < 33 || ascii(b, 12, 4) !== "IHDR") return { ok: false, reason: NOT_AN_IMAGE };
  // the file must end with a complete IEND chunk: no data after the image
  const end = b.length - 12;
  if (end < 33 || u32be(b, end) !== 0 || ascii(b, end + 4, 4) !== "IEND") return { ok: false, reason: "That picture has extra data after the image, so it can't be used." };
  return { ok: true, type: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): AvatarCheck {
  if (b.length < 4 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return { ok: false, reason: "That picture has extra data after the image, so it can't be used." };
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return { ok: false, reason: NOT_AN_IMAGE };
    const marker = b[i + 1]!;
    if (marker === 0xff) { i += 1; continue; }
    // start-of-frame markers carry the dimensions (not DHT 0xc4, JPG 0xc8, DAC 0xcc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { ok: true, type: "image/jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) break;
    i += 2 + u16be(b, i + 2);
  }
  return { ok: false, reason: NOT_AN_IMAGE };
}

function webp(b: Uint8Array): AvatarCheck {
  if (b.length < 30 || ascii(b, 8, 4) !== "WEBP") return { ok: false, reason: NOT_AN_IMAGE };
  // the RIFF size must account for every byte, so nothing rides along after the image
  if (u32le(b, 4) + 8 !== b.length) return { ok: false, reason: "That picture has extra data after the image, so it can't be used." };
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 ") return { ok: true, type: "image/webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  if (kind === "VP8L") {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! * 2 ** 24);
    return { ok: true, type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X") return { ok: true, type: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return { ok: false, reason: NOT_AN_IMAGE };
}

function u32le(b: Uint8Array, o: number) {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

export function checkAvatar(bytes: Uint8Array): AvatarCheck {
  if (bytes.length === 0) return { ok: false, reason: "No picture was sent." };
  if (bytes.length > AVATAR_MAX_BYTES) return { ok: false, reason: "That picture is too big. Pictures can be up to 100 KB after resizing." };
  const b = bytes;
  let found: AvatarCheck;
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) found = png(b);
  else if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) found = jpeg(b);
  else if (b.length > 12 && ascii(b, 0, 4) === "RIFF") found = webp(b);
  else return { ok: false, reason: NOT_AN_IMAGE };
  if (!found.ok) return found;
  if (found.width < 1 || found.height < 1 || found.width > AVATAR_MAX_SIDE || found.height > AVATAR_MAX_SIDE) {
    return { ok: false, reason: `That picture is too large. Pictures can be up to ${AVATAR_MAX_SIDE} by ${AVATAR_MAX_SIDE} pixels.` };
  }
  return found;
}
