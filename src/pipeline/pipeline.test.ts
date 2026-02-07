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
  test("@lua{...} tokenizes as DIRECTIVE + LBRACE (not a special token)", () => {
    const { cst } = parseSource("@lua{}");
    // Should produce a directive named "lua" with a structural body
    const luaDir = (cst.children as any[]).find(
      (c) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body).toBeDefined();
    expect(luaDir!.body.kind).toBe("StructuralBody");
  });

  test("@lua(args){} parses args correctly", () => {
    const { cst } = parseSource("@lua(once){}");
    const luaDir = (cst.children as any[]).find(
      (c) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.argsRaw).toBe("(once)");
    expect(luaDir!.body).toBeDefined();
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
