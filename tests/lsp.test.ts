import { describe, expect, test } from "bun:test";

import { parse } from "../src/parser/parser";
import { buildDocumentIndex } from "../src/lsp/indexer";
import { detectCompletionContext } from "../src/lsp/completion";

describe("LSP indexer", () => {
  test("indexes anchors, macros, and variable paths", () => {
    const source = `@document
  title: "Test"

@meta
  parties:
    seller: ACME
    buyer: Jane

@define Clause(name, value=1)
  @anchor Clause Anchor
  Hello {{parties.seller}}

@use Clause(name="X")

See [[Clause Anchor]].
`;

    const ast = parse(source, { sourcePath: "file:///test.ldoc" });
    const index = buildDocumentIndex("file:///test.ldoc", ast);

    expect(index.anchors.has("Clause Anchor")).toBe(true);
    expect(index.macros.has("Clause")).toBe(true);
    expect(index.setVariables.size).toBe(0);

    const clause = index.macros.get("Clause");
    expect(clause?.requiredParams).toEqual(["name"]);
    expect(clause?.optionalParams).toEqual(["value"]);

    expect(index.meta.pathsSet.has("parties")).toBe(true);
    expect(index.meta.pathsSet.has("parties.seller")).toBe(true);
  });
});

describe("LSP completion context", () => {
  test("detects directive completion after @", () => {
    const text = "@fo";
    const ctx = detectCompletionContext(text, { line: 0, character: 3 });
    expect(ctx.kind).toBe("directive");
    if (ctx.kind === "directive") expect(ctx.prefix).toBe("fo");
  });

  test("detects variable completion inside {{...}}", () => {
    const text = "Hello {{part";
    const ctx = detectCompletionContext(text, { line: 0, character: text.length });
    expect(ctx.kind).toBe("variable");
  });

  test("detects cross-ref completion inside [[...]]", () => {
    const text = "See [[Sec";
    const ctx = detectCompletionContext(text, { line: 0, character: text.length });
    expect(ctx.kind).toBe("cross_ref");
  });

  test("detects macro param key completion in @use call", () => {
    const text = "@use Clause(na";
    const ctx = detectCompletionContext(text, { line: 0, character: text.length });
    expect(ctx.kind).toBe("macro_param_key");
  });
});
