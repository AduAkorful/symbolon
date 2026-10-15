import { describe, expect, it } from "vitest";
import { checkAvatar } from "../src/avatar.js";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const text = (s: string) => [...s].map((c) => c.charCodeAt(0));

function pngBytes(w: number, h: number, trailing: number[] = []) {
  const ihdr = [...be32(13), ...text("IHDR"), ...be32(w), ...be32(h), 8, 2, 0, 0, 0, 0, 0, 0, 0];
  const iend = [...be32(0), ...text("IEND"), 0xae, 0x42, 0x60, 0x82];
  return new Uint8Array([0x89, ...text("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...iend, ...trailing]);
}
function jpegBytes(w: number, h: number, trailing: number[] = []) {
  const sof = [0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, ...sof, 0xff, 0xda, 0, 2, 0xff, 0xd9, ...trailing]);
}
function webpVp8x(w: number, h: number, extra = 0) {
  const chunk = [...text("VP8X"), ...le32(10), 0, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255, (h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255];
  const body = [...text("WEBP"), ...chunk];
  return new Uint8Array([...text("RIFF"), ...le32(body.length + extra), ...body]);
}

describe("avatar validation", () => {
  it("accepts a plain PNG, JPEG and WebP within the limits", () => {
    expect(checkAvatar(pngBytes(256, 256))).toMatchObject({ ok: true, type: "image/png", width: 256, height: 256 });
    expect(checkAvatar(jpegBytes(200, 100))).toMatchObject({ ok: true, type: "image/jpeg", width: 200, height: 100 });
    expect(checkAvatar(webpVp8x(256, 256))).toMatchObject({ ok: true, type: "image/webp", width: 256, height: 256 });
  });

  it("refuses SVG, GIF, HTML and empty input", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(checkAvatar(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ok).toBe(false);
    expect(checkAvatar(enc("GIF89a....................")).ok).toBe(false);
    expect(checkAvatar(enc("<html><script>alert(1)</script></html>")).ok).toBe(false);
    expect(checkAvatar(new Uint8Array()).ok).toBe(false);
  });

  it("refuses data after the end of the image (a polyglot)", () => {
    expect(checkAvatar(pngBytes(64, 64, text("<script>x</script>"))).ok).toBe(false);
    expect(checkAvatar(jpegBytes(64, 64, text("<script>x</script>"))).ok).toBe(false);
    
    const padded = new Uint8Array([...webpVp8x(64, 64), ...text("<script>")]);
    expect(checkAvatar(padded).ok).toBe(false);
  });

  it("refuses pictures larger than 512 px or 100 KB", () => {
    expect(checkAvatar(pngBytes(513, 100)).ok).toBe(false);
    expect(checkAvatar(jpegBytes(100, 600)).ok).toBe(false);
    expect(checkAvatar(new Uint8Array(101 * 1024).fill(0xff)).ok).toBe(false);
  });
});
