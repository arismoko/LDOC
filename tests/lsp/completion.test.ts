/**
 * LSP Completion Tests
 */

import { describe, test, expect } from "bun:test";
import {
  getCompletionContext,
  getCompletionItems,
  type CompletionContext,
} from "../../src/lsp/completion.ts";
import { parseSource } from "../../src/parse/index.ts";
import { bind } from "../../src/bind/binder.ts";
import { createSymbolTable } from "../../src/types/symbols.ts";
import type { Position } from "vscode-languageserver";

/**
 * Create a 0-based LSP position.
 */
function pos(line: number, character: number): Position {
  return { line, character };
}

/**
 * Parse source and get context at position.
 */
function getContext(source: string, position: Position): CompletionContext {
  const { cst } = parseSource(source);
  return getCompletionContext(cst, position, source);
}

describe("getCompletionContext", () => {
  describe("directive completion", () => {
    test("detects @ at start of line", () => {
      const ctx = getContext("@", pos(0, 1));
      expect(ctx.kind).toBe("directive");
      if (ctx.kind === "directive") {
        expect(ctx.prefix).toBe("");
      }
    });

    test("detects partial directive name", () => {
      const ctx = getContext("@doc", pos(0, 4));
      expect(ctx.kind).toBe("directive");
      if (ctx.kind === "directive") {
        expect(ctx.prefix).toBe("doc");
      }
    });

    test("detects @ after whitespace", () => {
      const ctx = getContext("  @if", pos(0, 5));
      expect(ctx.kind).toBe("directive");
      if (ctx.kind === "directive") {
        expect(ctx.prefix).toBe("if");
      }
    });
  });

  describe("variable completion", () => {
    test("detects inside unclosed variable", () => {
      const ctx = getContext("Hello {{ na", pos(0, 11));
      expect(ctx.kind).toBe("variable");
      if (ctx.kind === "variable") {
        expect(ctx.prefix).toBe("na");
      }
    });

    test("detects empty variable", () => {
      const ctx = getContext("Hello {{ ", pos(0, 9));
      expect(ctx.kind).toBe("variable");
    });

    test("detects filter context after pipe", () => {
      const ctx = getContext("{{ name | up", pos(0, 12));
      expect(ctx.kind).toBe("variable_filter");
      if (ctx.kind === "variable_filter") {
        expect(ctx.prefix).toBe("up");
      }
    });
  });

  describe("cross-reference completion", () => {
    test("detects inside unclosed cross-ref", () => {
      const ctx = getContext("See [[sec", pos(0, 9));
      expect(ctx.kind).toBe("cross_ref");
      if (ctx.kind === "cross_ref") {
        expect(ctx.prefix).toBe("sec");
      }
    });

    test("detects empty cross-ref", () => {
      const ctx = getContext("See [[", pos(0, 6));
      expect(ctx.kind).toBe("cross_ref");
      if (ctx.kind === "cross_ref") {
        expect(ctx.prefix).toBe("");
      }
    });
  });

  describe("footnote completion", () => {
    test("detects footnote ref start", () => {
      const ctx = getContext("Text[^no", pos(0, 8));
      expect(ctx.kind).toBe("footnote_ref");
      if (ctx.kind === "footnote_ref") {
        expect(ctx.prefix).toBe("no");
      }
    });
  });

  describe("macro completion", () => {
    test("detects inside @use()", () => {
      const ctx = getContext("@use(gre", pos(0, 8));
      expect(ctx.kind).toBe("macro_name");
      if (ctx.kind === "macro_name") {
        expect(ctx.prefix).toBe("gre");
      }
    });

    test("detects empty @use()", () => {
      const ctx = getContext("@use(", pos(0, 5));
      expect(ctx.kind).toBe("macro_name");
      if (ctx.kind === "macro_name") {
        expect(ctx.prefix).toBe("");
      }
    });
  });

  describe("no completion context", () => {
    test("plain text has no context", () => {
      const ctx = getContext("Hello world", pos(0, 5));
      expect(ctx.kind).toBe("none");
    });

    test("closed variable has no context", () => {
      const ctx = getContext("{{ name }}", pos(0, 10));
      expect(ctx.kind).toBe("none");
    });
  });
});

describe("getCompletionItems", () => {
  const emptySymbols = createSymbolTable();
  const defaultOptions = { snippetSupport: true };

  describe("directive completions", () => {
    test("returns all directives with empty prefix", () => {
      const items = getCompletionItems(
        { kind: "directive", prefix: "" },
        emptySymbols,
        defaultOptions
      );
      expect(items.length).toBeGreaterThan(10);
      expect(items.some((i) => i.label === "@document")).toBe(true);
      expect(items.some((i) => i.label === "@if")).toBe(true);
    });

    test("filters by prefix", () => {
      const items = getCompletionItems(
        { kind: "directive", prefix: "doc" },
        emptySymbols,
        defaultOptions
      );
      expect(items.every((i) => i.label.startsWith("@doc"))).toBe(true);
    });

    test("includes snippets when supported", () => {
      const items = getCompletionItems(
        { kind: "directive", prefix: "if" },
        emptySymbols,
        { snippetSupport: true }
      );
      const ifItem = items.find((i) => i.label === "@if");
      expect(ifItem?.insertText).toContain("$0");
    });
  });

  describe("variable completions", () => {
    test("returns built-in variables", () => {
      const items = getCompletionItems(
        { kind: "variable", prefix: "" },
        emptySymbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "loop.index")).toBe(true);
      expect(items.some((i) => i.label === "loop.first")).toBe(true);
    });

    test("returns variables from symbol table", async () => {
      const source = `@set(myVar, value: 42)`;
      const { cst } = parseSource(source);
      const { symbols } = await bind(cst);

      const items = getCompletionItems(
        { kind: "variable", prefix: "" },
        symbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "myVar")).toBe(true);
    });
  });

  describe("filter completions", () => {
    test("returns all filters", () => {
      const items = getCompletionItems(
        { kind: "variable_filter", prefix: "" },
        emptySymbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "upper")).toBe(true);
      expect(items.some((i) => i.label === "lower")).toBe(true);
      expect(items.some((i) => i.label === "capitalize")).toBe(true);
    });

    test("filters by prefix", () => {
      const items = getCompletionItems(
        { kind: "variable_filter", prefix: "up" },
        emptySymbols,
        defaultOptions
      );
      expect(items.length).toBe(1);
      expect(items[0]?.label).toBe("upper");
    });
  });

  describe("macro completions", () => {
    test("returns macros from symbol table", async () => {
      const source = `@define(greeting)
Hello!
@end`;
      const { cst } = parseSource(source);
      const { symbols } = await bind(cst);

      const items = getCompletionItems(
        { kind: "macro_name", prefix: "" },
        symbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "greeting")).toBe(true);
    });
  });

  describe("anchor completions", () => {
    test("returns anchors from symbol table", async () => {
      const source = `@anchor(section1)
# Section 1`;
      const { cst } = parseSource(source);
      const { symbols } = await bind(cst);

      const items = getCompletionItems(
        { kind: "cross_ref", prefix: "" },
        symbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "section1")).toBe(true);
    });
  });

  describe("footnote completions", () => {
    test("returns footnotes from symbol table", async () => {
      const source = `[^note]: This is a footnote.`;
      const { cst } = parseSource(source);
      const { symbols } = await bind(cst);

      const items = getCompletionItems(
        { kind: "footnote_ref", prefix: "" },
        symbols,
        defaultOptions
      );
      expect(items.some((i) => i.label === "note")).toBe(true);
    });
  });
});
