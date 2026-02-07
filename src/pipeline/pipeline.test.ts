/**
 * Pipeline integration tests.
 */

import { describe, test, expect } from "bun:test";
import { tryCompile } from "./index.ts";
import { parseSource } from "../parse/index.ts";

describe("tryCompile", () => {
  test("returns diagnostics on parse failure", async () => {
    // Unterminated paragraph block should produce parse diagnostics
    const result = await tryCompile("[unterminated paragraph");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test("returns diagnostics on successful compile", async () => {
    const result = await tryCompile("[Hello world]");
    expect(result.ok).toBe(true);
    // May or may not have diagnostics, but should not throw
    if (result.ok) {
      expect(result.value.buffer).toBeInstanceOf(Uint8Array);
    }
  });
});

describe("@lua directive parsing", () => {
  test("@lua{...} parses as RawBody", () => {
    const { cst } = parseSource("@lua{}");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe("");
  });

  test("@lua(args){} parses args correctly with RawBody", () => {
    const { cst } = parseSource("@lua(once){}");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.argsRaw).toBe("(once)");
    expect(luaDir!.body).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
  });

  test("@lua{ x = { 1, 2 } } handles nested braces in Lua tables", () => {
    const { cst, diagnostics } = parseSource("@lua{ x = { 1, 2 } }");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe(" x = { 1, 2 } ");
    expect(diagnostics.filter((d: any) => d.severity === "error")).toHaveLength(0);
  });

  test('@lua{ s = "}" } handles braces inside Lua strings', () => {
    const { cst, diagnostics } = parseSource('@lua{ s = "}" }');
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe(' s = "}" ');
    expect(diagnostics.filter((d: any) => d.severity === "error")).toHaveLength(0);
  });

  test("@lua{ -- }\\nx = 1 } handles braces inside Lua line comments", () => {
    const src = "@lua{ -- }\nx = 1 }";
    const { cst, diagnostics } = parseSource(src);
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe(" -- }\nx = 1 ");
    expect(diagnostics.filter((d: any) => d.severity === "error")).toHaveLength(0);
  });

  test("@lua{ s = [=[}]=] } handles braces inside Lua long strings", () => {
    const { cst, diagnostics } = parseSource("@lua{ s = [=[}]=] }");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe(" s = [=[}]=] ");
    expect(diagnostics.filter((d: any) => d.severity === "error")).toHaveLength(0);
  });

  test("@lua{ s = '}' } handles braces inside single-quoted Lua strings", () => {
    const { cst, diagnostics } = parseSource("@lua{ s = '}' }");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    expect(luaDir!.body.text).toBe(" s = '}' ");
    expect(diagnostics.filter((d: any) => d.severity === "error")).toHaveLength(0);
  });

  test("unterminated @lua{ emits diagnostic via EOF recovery", () => {
    const { cst, diagnostics } = parseSource("@lua{ x = 1");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    // Should have a diagnostic about unterminated raw body
    expect(diagnostics.some((d: any) => d.message.toLowerCase().includes("unterminated"))).toBe(true);
  });
});

describe("single-quoted string roundtrip", () => {
  test("single-quoted args preserve quote type through parsing", () => {
    const { cst } = parseSource("@style(ref: 'h1')");
    const dir = (cst.children as any[]).find((c) => c.kind === "Directive");
    expect(dir).toBeDefined();
    // argsRaw should contain single quotes, not double quotes
    expect(dir!.argsRaw).toContain("'h1'");
    expect(dir!.argsRaw).not.toContain('"h1"');
  });
});

describe("unterminated inline directive body", () => {
  test("EOF inside inline directive body emits diagnostic and flushes text", () => {
    const { cst, diagnostics } = parseSource("[@bold{unterminated");
    // Should have an unclosed delimiter diagnostic
    expect(diagnostics.some((d) => d.message.includes("nterminated"))).toBe(true);
    // Should still produce a paragraph with the inline directive
    const para = (cst.children as any[]).find((c) => c.kind === "ParagraphBlock");
    expect(para).toBeDefined();
  });
});

describe("whitespace between directive name/args/body (Spec §5.1)", () => {
  test("structural: @style (ref: 'h1') parses args with space before parens", () => {
    const { cst } = parseSource("@style (ref: 'h1')");
    const dir = (cst.children as any[]).find((c) => c.kind === "Directive");
    expect(dir).toBeDefined();
    expect(dir!.argsRaw).toContain("ref");
  });

  test("structural: @section (title: 'x') { } parses args and body with spaces", () => {
    const { cst } = parseSource("@section (title: 'x') {}");
    const dir = (cst.children as any[]).find((c) => c.kind === "Directive");
    expect(dir).toBeDefined();
    expect(dir!.argsRaw).toContain("title");
    expect(dir!.body).toBeDefined();
  });

  test("list marker: @# (start: 5) [Item] parses args + body with spaces", () => {
    const { cst } = parseSource("@# (start: 5) [Item]");
    const marker = (cst.children as any[]).find((c) => c.kind === "ListItemMarker");
    expect(marker).toBeDefined();
    expect(marker!.argsRaw).toContain("start");
    expect(marker!.body).toBeDefined();
  });

  test("inline: [@bold {text}] parses body with space before brace", () => {
    const { cst } = parseSource("[@bold {text}]");
    const para = (cst.children as any[]).find((c) => c.kind === "ParagraphBlock");
    expect(para).toBeDefined();
    const inlineDir = para!.inlines.find((i: any) => i.kind === "InlineDirective");
    expect(inlineDir).toBeDefined();
    expect(inlineDir!.body).toBeDefined();
    expect(inlineDir!.body.length).toBeGreaterThan(0);
  });

  test("newline between name and args does NOT bind (conservative)", () => {
    const { cst } = parseSource("@style\n(ref: 'h1')");
    const dir = (cst.children as any[]).find((c) => c.kind === "Directive");
    expect(dir).toBeDefined();
    // Args should NOT be attached — newline separates them
    expect(dir!.argsRaw).toBeUndefined();
  });

  test("inline: space before non-delimiter is preserved as content", () => {
    const { cst } = parseSource("[@foo bar]");
    const para = (cst.children as any[]).find((c) => c.kind === "ParagraphBlock");
    expect(para).toBeDefined();
    // The space between @foo and bar must be preserved as inline text
    const texts = para!.inlines
      .filter((i: any) => i.kind === "InlineText")
      .map((i: any) => i.text);
    const joined = texts.join("");
    expect(joined).toContain(" bar");
  });

  test("inline: space after args before non-delimiter is preserved", () => {
    const { cst } = parseSource("[@foo(x: 1) bar]");
    const para = (cst.children as any[]).find((c) => c.kind === "ParagraphBlock");
    expect(para).toBeDefined();
    const texts = para!.inlines
      .filter((i: any) => i.kind === "InlineText")
      .map((i: any) => i.text);
    const joined = texts.join("");
    expect(joined).toContain(" bar");
  });
});

describe("non-whitespace TEXT at structural level", () => {
  test("bare text at structural level emits diagnostic", () => {
    const { diagnostics } = parseSource("hello world");
    // Should warn about text outside paragraph block
    expect(diagnostics.some((d) => d.message.includes("paragraph block"))).toBe(true);
  });

  test("whitespace-only text at structural level does not emit diagnostic", () => {
    const { diagnostics } = parseSource("  @document(title: 'x')");
    // Indentation should not produce diagnostics
    const textDiags = diagnostics.filter((d) => d.message.includes("paragraph block"));
    expect(textDiags.length).toBe(0);
  });

  test("indented directives still parse cleanly", () => {
    const { cst, diagnostics } = parseSource("  @section {\n    [Hello]\n  }");
    const dir = (cst.children as any[]).find((c) => c.kind === "Directive");
    expect(dir).toBeDefined();
    expect(dir!.body).toBeDefined();
    const textDiags = diagnostics.filter((d) => d.message.includes("paragraph block"));
    expect(textDiags.length).toBe(0);
  });
});
