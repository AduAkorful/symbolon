// Text that people will read and sign has to be the same bytes they see. Control characters and bidirectional overrides can make
// rendered text differ from its bytes, so they are refused (or, for uploads, replaced) wherever text comes in. The seal package
// enforces the same set on the canonical document; this is the app's copy of the rule for input.

/** Control characters and bidi/line-separator characters */
export const UNSAFE_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/u;
/** The same set, global, for replacing */
export const UNSAFE_TEXT_G = /[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/gu;
/** Bidi and separator characters only (newlines are allowed in multi-line text) */
export const BIDI_TEXT = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/u;
