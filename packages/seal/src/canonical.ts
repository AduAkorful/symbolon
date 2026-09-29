import { SealError } from "./errors.js";

/**
 * Canonical JSON for Symbolon documents: object keys sorted by UTF-16 code unit, no whitespace, strings escaped as
 * `JSON.stringify` escapes them, numbers restricted to non-negative safe integers. For this value set the output is
 * RFC 8785 (JCS). `undefined` properties are omitted, exactly as if absent; booleans encode as `true`/`false`
 * (decision records use them; invoice documents have none); `null`, floats, negative numbers, bigints and non-plain
 * objects are rejected rather than coerced.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, "");
}

function encode(value: unknown, path: string): string {
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new SealError(`${path || "(root)"} contains an unpaired surrogate`);
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SealError(`${path || "(root)"} must be a non-negative safe integer, got ${value}`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, i) => encode(item, `${path}[${i}]`)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      // default sort compares UTF-16 code units, which is what RFC 8785 requires
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${encode(v, path ? `${path}.${k}` : k)}`).join(",")}}`;
  }
  throw new SealError(`${path || "(root)"} has an unsupported value type (${value === null ? "null" : typeof value})`);
}
