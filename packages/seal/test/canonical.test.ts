import { describe, expect, it } from "vitest";

import { canonicalJson, SealError } from "../src/index.js";

describe("canonicalJson", () => {
  it("sorts keys by UTF-16 code unit at every depth and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: "x", y: "y" }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":"y","z":"x"}]},"b":1}',
    );
    // code-unit order, not code-point order: U+1F600 (surrogates D83D DE00) sorts before U+FFFF
    expect(canonicalJson({ "é": 1, a: 2, B: 3, "￿": 4, "\u{1F600}": 5 })).toBe(
      '{"B":3,"a":2,"é":1,"\u{1F600}":5,"￿":4}',
    );
  });

  it("encodes booleans as JSON literals", () => {
    expect(canonicalJson({ b: false, a: true })).toBe('{"a":true,"b":false}');
  });

  it("escapes strings as JSON.stringify does", () => {
    expect(canonicalJson({ s: 'a"b\\c\n\u0001é' })).toBe('{"s":"a\\"b\\\\c\\n\\u0001é"}');
  });

  it.each([
    ["null", { a: null }],
    ["float", { a: 1.5 }],
    ["negative", { a: -1 }],
    ["unsafe integer", { a: 2 ** 53 }],
    ["bigint", { a: 1n }],
    ["date", { a: new Date(0) }],
    ["lone surrogate", { a: "\ud800" }],
  ])("rejects %s", (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(SealError);
  });
});
