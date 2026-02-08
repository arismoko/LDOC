/**
 * Pipeline integration tests.
 */

import { describe, test, expect } from "bun:test";
import { resolve as resolvePath } from "node:path";
import { tryCompile, parseAndBind, parseAndBindWithIncludes, compileToDocument } from "./index.ts";
import { parseSource } from "../parse/index.ts";
import { evaluate } from "../evaluate/index.ts";
import { bindSync } from "../bind/index.ts";

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

  test("@lua(args){} parses args but bind warns about unwanted args", () => {
    const { cst } = parseSource("@lua(once){}");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.argsRaw).toBe("(once)");
    expect(luaDir!.body).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");

    // Bind should warn that @lua doesn't accept args
    const bindResult = bindSync(cst);
    expect(bindResult.diagnostics.some((d: any) => d.message.includes("does not accept arguments"))).toBe(true);
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

  test('@lua{ x = "}" .. y } does not consume later braces', () => {
    const src = '@lua{ x = "}" .. y }\n@foo{}';
    const { cst, diagnostics } = parseSource(src);
    const directives = (cst.children as any[]).filter(
      (c: any) => c.kind === "Directive"
    );
    expect(directives).toHaveLength(2);
    expect(directives[0]!.name).toBe("lua");
    expect(directives[0]!.body.kind).toBe("RawBody");
    expect(directives[0]!.body.text).toBe(' x = "}" .. y ');
    expect(directives[1]!.name).toBe("foo");
    expect(directives[1]!.body).toBeDefined();
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

// =============================================================================
// Phase boundary enforcement (Spec §18)
// =============================================================================

describe("phase boundaries", () => {
  test("symbol table is frozen after bind — defs.set() throws", () => {
    const { symbols } = parseAndBind("@def(x: 1)");
    expect(symbols.defs.size).toBe(1);
    expect(() => symbols.defs.set("y", {} as any)).toThrow(/frozen/);
  });

  test("symbol table is frozen after bind — anchors.set() throws", () => {
    const { symbols } = parseAndBind("@anchor(id: 'a')");
    expect(symbols.anchors.size).toBe(1);
    expect(() => symbols.anchors.set("b", {} as any)).toThrow(/frozen/);
  });

  test("symbol table is frozen after bind — delete throws", () => {
    const { symbols } = parseAndBind("@def(x: 1)");
    expect(() => symbols.defs.delete("x")).toThrow(/frozen/);
  });

  test("symbol table is frozen after bind — clear throws", () => {
    const { symbols } = parseAndBind("@def(x: 1)");
    expect(() => symbols.defs.clear()).toThrow(/frozen/);
  });

  test("evaluator defs are a copy — symbol table unchanged after evaluate", async () => {
    const { cst, symbols } = parseAndBind("@def(x: 1)\n[$(x)]");
    const defsBefore = Array.from(symbols.defs.entries());

    const { document } = await evaluate(cst, symbols);
    expect(document.blocks.length).toBeGreaterThan(0);

    // Symbol table must be identical after evaluate
    const defsAfter = Array.from(symbols.defs.entries());
    expect(defsAfter).toEqual(defsBefore);
  });

  test("full pipeline preserves symbol table immutability", async () => {
    const source = "@def(title: 'Hello')\n[$(title)]";
    const { diagnostics } = await compileToDocument(source);

    // Should compile without errors
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  test("symbol table entries are frozen — value mutation throws", () => {
    const { symbols } = parseAndBind("@def(x: 1)");
    const sym = symbols.defs.get("x")!;
    expect(() => { (sym as any).value = 999; }).toThrow();
  });

  test("symbol table entries are frozen — usages mutation throws", () => {
    const { symbols } = parseAndBind("@def(x: 1)");
    const sym = symbols.defs.get("x")!;
    expect(() => { (sym.usages as any).push({}); }).toThrow();
  });

  test("symbol table entries are frozen — nested value mutation throws", () => {
    const { symbols } = parseAndBind("@def(meta: { title: 'Hello', count: 2 })");
    const sym = symbols.defs.get("meta")!;
    expect(() => { (sym.value as any).title = "Mutated"; }).toThrow();
  });

  test("Lua can mutate nested def values at runtime (§18.1.1)", async () => {
    // Frozen bind-time defs must be deep-cloned for the evaluator so Lua
    // mutations on nested objects succeed (regression: deep-freeze leaked).
    const source = "@def(meta: { count: 2 })\n@lua{ defs.meta.count = 42 }\n[$(defs.meta.count)]";
    const { cst, symbols } = parseAndBind(source);

    const { document, diagnostics } = await evaluate(cst, symbols);
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);

    // The paragraph should contain the mutated value "42"
    const para = document.blocks.find((b) => b.type === "Paragraph") as any;
    expect(para).toBeDefined();
    const text = para.content.find((i: any) => i.type === "Text");
    expect(text?.value).toBe("42");

    // Symbol table must remain frozen and unchanged
    const sym = symbols.defs.get("meta")!;
    expect((sym.value as any).count).toBe(2);
  });

  test("parse output is not mutated by bind", () => {
    const { cst } = parseSource("@def(x: 1)\n[Hello]");
    const childrenBefore = cst.children.length;

    parseAndBind("@def(x: 1)\n[Hello]");

    // Original CST from separate parse should be untouched
    expect(cst.children.length).toBe(childrenBefore);
  });
});

// =============================================================================
// Cross-file anchor/ref validation
// =============================================================================

describe("cross-file ref validation", () => {
  function createMapLoader(files: Record<string, string>) {
    return async (path: string): Promise<string> => {
      const value = files[path];
      if (value === undefined) {
        throw new Error(`Missing fixture file: ${path}`);
      }
      return value;
    };
  }

  test("ref to anchor in included file resolves without warning", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")\n[@ref(id: "sec1")]`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@anchor(id: "sec1")\n[Section One]`,
        }),
      },
    );

    // No B009 warning — anchor exists in child
    expect(diagnostics.some((d) => d.code === "B009")).toBe(false);
  });

  test("ref to missing anchor across files emits B009 warning", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")\n[@ref(id: "missing")]`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@anchor(id: "sec1")\n[Section One]`,
        }),
      },
    );

    // B009 warning — "missing" doesn't exist anywhere
    expect(diagnostics.some((d) => d.code === "B009")).toBe(true);
  });

  test("ref inside included file to anchor in entry file resolves", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@anchor(id: "top")\n@include(path: "child.ldoc")`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `[@ref(id: "top")]`,
        }),
      },
    );

    // No B009 — included file references entry anchor
    expect(diagnostics.some((d) => d.code === "B009")).toBe(false);
  });

  test("ref inside included file to nonexistent anchor emits B009", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `[@ref(id: "nowhere")]`,
        }),
      },
    );

    // B009 — "nowhere" doesn't exist in any file
    expect(diagnostics.some((d) => d.code === "B009")).toBe(true);
  });

  test("bind-with-includes validates unknown directives inside included files", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@unknownDirective()`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B020")).toBe(true);
  });

  test("bind-time @params arity: missing required arg emits B007", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    // B007 is an error, so parseAndBindWithIncludes throws via throwOnBindErrors.
    // Use tryCompile or catch the pipeline error to inspect diagnostics.
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { name: "Alice" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(names: ["name", "title"])\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const arityDiags = diagnostics.filter((d: any) => d.code === "B007");
    expect(arityDiags).toHaveLength(1);
    expect(arityDiags[0]!.message).toContain("title");
  });

  test("bind-time @params arity: all required args present emits no B007", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc", args: { name: "Alice", title: "CEO" })`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@params(names: ["name", "title"])\n[Signer]`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B007")).toBe(false);
  });

  test("bind-time @params arity: same file included twice with different args", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    // Second include is missing "title" — B007 error causes throw
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { name: "Alice", title: "CEO" })\n@include(path: "child.ldoc", args: { name: "Bob" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(names: ["name", "title"])\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    // First include has all args — no B007
    // Second include missing "title" — one B007
    const arityDiags = diagnostics.filter((d: any) => d.code === "B007");
    expect(arityDiags).toHaveLength(1);
    expect(arityDiags[0]!.message).toContain("title");
  });

   test("duplicate @anchor across include sites emits B004", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    // Same file included twice — its @anchor(id: "sec1") should flag as duplicate
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc")\n@include(path: "child.ldoc")`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@anchor(id: "sec1")\n[Section One]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const dupDiags = diagnostics.filter((d: any) => d.code === "B004" && d.message.includes("anchor"));
    expect(dupDiags).toHaveLength(1);
    expect(dupDiags[0]!.message).toContain("sec1");
  });

   test("single include with @anchor emits no duplicate B004", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@anchor(id: "sec1")\n[Section One]`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B004")).toBe(false);
  });

  test("bind-time @params arity: no @params in included file emits no B007", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc")`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `[Plain content]`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B007")).toBe(false);
  });

  test("bind-time @params types: matching args emit no B015", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc", args: { name: "Alice", age: 30, flags: ["x"], meta: { ok: true } })`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@params(types: { name: "string", age: "number", flags: "array", meta: "object" })\n[Signer]`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B015")).toBe(false);
  });

  test("bind-time @params types: mismatch emits B015", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { age: "30" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(types: { age: "number" })\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const typeDiags = diagnostics.filter((d: any) => d.code === "B015");
    expect(typeDiags).toHaveLength(1);
    expect(typeDiags[0]!.message).toContain("age");
  });

  test("bind-time @params types: optional type can be omitted", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc", args: { name: "Alice" })`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@params(types: { name: "string", title: "string?" })\n[Signer]`,
        }),
      },
    );

    expect(diagnostics.some((d) => d.code === "B007")).toBe(false);
    expect(diagnostics.some((d) => d.code === "B015")).toBe(false);
  });

  test("bind-time @params types: malformed literals emit B014", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { name: "Alice" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(types: { name: "str" })\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const malformedDiags = diagnostics.filter((d: any) => d.code === "B014");
    expect(malformedDiags).toHaveLength(1);
  });

  test("bind-time @params types: keys must be in names when names is provided", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { extra: "x" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(names: ["name"], types: { extra: "string" })\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const malformedDiags = diagnostics.filter((d: any) => d.code === "B014");
    expect(malformedDiags).toHaveLength(1);
  });

  test("bind-time @params: optional typed param in names+types can be omitted without B007", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const { diagnostics } = await parseAndBindWithIncludes(
      `@include(path: "child.ldoc", args: { name: "Alice" })`,
      {
        sourcePath: mainPath,
        loadFile: createMapLoader({
          [childPath]: `@params(names: ["name", "title"], types: { name: "string", title: "string?" })\n[Signer]`,
        }),
      },
    );

    // "title" is optional via "string?" — omitting it must NOT trigger B007
    expect(diagnostics.some((d) => d.code === "B007")).toBe(false);
    expect(diagnostics.some((d) => d.code === "B015")).toBe(false);
  });

  test("bind-time @params: empty names array rejects types keys with B014", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    let caught: any;
    try {
      await parseAndBindWithIncludes(
        `@include(path: "child.ldoc", args: { extra: "x" })`,
        {
          sourcePath: mainPath,
          loadFile: createMapLoader({
            [childPath]: `@params(names: [], types: { extra: "string" })\n[Signer]`,
          }),
        },
      );
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const diagnostics: any[] = caught.diagnostics ?? [];
    const malformedDiags = diagnostics.filter((d: any) => d.code === "B014");
    expect(malformedDiags).toHaveLength(1);
    expect(malformedDiags[0]!.message).toContain("extra");
  });
});

// =============================================================================
// Regression: isArgsParseError type guard (PR #4 Codex review)
// =============================================================================

describe("args parsing edge cases", () => {
  test("@foo(ok: false) is valid args, not a parse error", () => {
    const { cst, diagnostics } = parseSource("@foo(ok: false)");
    const dir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "foo"
    );
    expect(dir).toBeDefined();
    // args.ok should be the boolean false, not treated as parse failure
    expect(dir!.args).toBeDefined();
    expect(dir!.args!.ok).toBe(false);
    // No parse diagnostics from args parsing itself
    const parseDiags = diagnostics.filter((d) => d.code === "P006");
    expect(parseDiags).toHaveLength(0);
  });

  test("@bar(ok: false, raw: 'test') is valid args with both keys", () => {
    const { cst, diagnostics } = parseSource("@bar(ok: false, raw: 'test')");
    const dir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "bar"
    );
    expect(dir).toBeDefined();
    expect(dir!.args).toBeDefined();
    expect(dir!.args!.ok).toBe(false);
    expect(dir!.args!.raw).toBe("test");
    const parseDiags = diagnostics.filter((d) => d.code === "P006");
    expect(parseDiags).toHaveLength(0);
  });
});

// =============================================================================
// Regression: raw-body directives reject paragraph sugar (PR #4 Codex review)
// =============================================================================

describe("raw-body directive sugar rejection", () => {
  test("@lua[...] emits P005 warning and drops body", () => {
    const { cst, diagnostics } = parseSource("@lua[print('hello')]");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    // Body should NOT be attached — sugar form rejected
    expect(luaDir!.body).toBeUndefined();
    // Should have a P005 diagnostic about brace syntax
    const sugarDiags = diagnostics.filter(
      (d) => d.code === "P005" && d.message.includes("brace syntax")
    );
    expect(sugarDiags).toHaveLength(1);
  });

  test("@lua{...} still parses as RawBody (no regression)", () => {
    const { cst, diagnostics } = parseSource("@lua{ print('hello') }");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    expect(luaDir!.body).toBeDefined();
    expect(luaDir!.body.kind).toBe("RawBody");
    // No P005 warnings
    expect(diagnostics.filter((d) => d.code === "P005")).toHaveLength(0);
  });

  test("@lua(args)[...] rejects sugar and preserves args", () => {
    const { cst, diagnostics } = parseSource("@lua(x: 1)[print('hello')]");
    const luaDir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "lua"
    );
    expect(luaDir).toBeDefined();
    // Args should still be parsed
    expect(luaDir!.args).toBeDefined();
    // Body should be dropped (sugar rejected)
    expect(luaDir!.body).toBeUndefined();
    // Should have P005 warning
    expect(diagnostics.some((d) => d.code === "P005" && d.message.includes("brace syntax"))).toBe(true);
  });

  test("unknown directive with [...] sugar is not rejected as raw-body", () => {
    const { cst, diagnostics } = parseSource("@custom[Hello]");
    const dir = (cst.children as any[]).find(
      (c: any) => c.kind === "Directive" && c.name === "custom"
    );
    expect(dir).toBeDefined();
    // Body SHOULD be attached — unknown directives don't have raw-body contract
    expect(dir!.body).toBeDefined();
    expect(dir!.body.kind).toBe("StructuralBody");
    // No P005 warnings
    expect(diagnostics.filter((d) => d.code === "P005")).toHaveLength(0);
  });
});

// =============================================================================
// Regression: args parse error location rebased to args span (PR #4 oracle review)
// =============================================================================

describe("args parse error location precision", () => {
  test("error column points into args span, not at directive start", () => {
    // Source: @foo(a: a: 1)
    // The duplicate colon makes "a: a: 1" fail — key "a" parsed, value "a" parsed,
    // then remaining ": 1" is unexpected. The error column must be past the LPAREN,
    // not at the directive start (@).
    const { diagnostics } = parseSource("@foo(a: a: 1)");
    const parseDiags = diagnostics.filter((d) => d.code === "P006");
    expect(parseDiags).toHaveLength(1);
    // LPAREN is at col 4 (0-based). Error must point past it into the args content.
    expect(parseDiags[0]!.location.column).toBeGreaterThan(4);
  });

  test("duplicate key error points at the duplicate key position", () => {
    // Source: @foo(x: 1, x: 2)
    // "x" first defined, "x" duplicate — error should point at second "x"
    const { diagnostics } = parseSource("@foo(x: 1, x: 2)");
    const dupDiags = diagnostics.filter((d) => d.code === "B004");
    expect(dupDiags).toHaveLength(1);
    // Second "x" is at col 11 (0-based). Error must be past LPAREN (col 4).
    expect(dupDiags[0]!.location.column).toBeGreaterThan(4);
  });

  test("multiline args parse errors are rebased to the correct source line", () => {
    const src = "@foo(\n  a: 1,\n  b\n)";
    const { diagnostics } = parseSource(src);
    const parseDiags = diagnostics.filter((d) => d.code === "P006");
    expect(parseDiags).toHaveLength(1);
    expect(parseDiags[0]!.location.line).toBe(3);
    expect(parseDiags[0]!.location.column).toBeGreaterThanOrEqual(2);
  });
});
