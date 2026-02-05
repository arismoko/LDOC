/**
 * LSP Completion Tests
 * 
 * Tests for the completion context detection and completion generation.
 */

import { describe, test, expect } from "bun:test";
import { detectCompletionContext, completeForContext, type CompletionContext } from "../src/lsp/completion";
import { buildDocumentIndex, type DocumentIndex } from "../src/lsp/indexer";
import { parse } from "../src/parser/parser";

describe("LSP Completion", () => {
  describe("detectCompletionContext", () => {
    test("detects directive context after @", () => {
      const text = "@";
      const ctx = detectCompletionContext(text, { line: 0, character: 1 });
      expect(ctx.kind).toBe("directive");
      expect((ctx as { prefix: string }).prefix).toBe("");
    });

    test("detects directive context with prefix", () => {
      const text = "@doc";
      const ctx = detectCompletionContext(text, { line: 0, character: 4 });
      expect(ctx.kind).toBe("directive");
      expect((ctx as { prefix: string }).prefix).toBe("doc");
    });

    test("detects variable context inside {{}}", () => {
      const text = "Hello {{na";
      const ctx = detectCompletionContext(text, { line: 0, character: 10 });
      expect(ctx.kind).toBe("variable");
      expect((ctx as { prefix: string }).prefix).toBe("na");
    });

    test("detects variable filter context after |", () => {
      const text = "{{name | up";
      const ctx = detectCompletionContext(text, { line: 0, character: 11 });
      expect(ctx.kind).toBe("variable_filter");
      expect((ctx as { prefix: string }).prefix).toBe("up");
    });

    test("detects cross_ref context inside [[]]", () => {
      const text = "See [[Sect";
      const ctx = detectCompletionContext(text, { line: 0, character: 10 });
      expect(ctx.kind).toBe("cross_ref");
      expect((ctx as { prefix: string }).prefix).toBe("Sect");
    });

    test("detects macro_name context after @use", () => {
      const text = "@use Gre";
      const ctx = detectCompletionContext(text, { line: 0, character: 8 });
      expect(ctx.kind).toBe("macro_name");
      expect((ctx as { prefix: string; directive: string }).prefix).toBe("Gre");
      expect((ctx as { prefix: string; directive: string }).directive).toBe("use");
    });

    test("detects macro_param_key context inside @use(...)", () => {
      const text = "@use Greeting(na";
      const ctx = detectCompletionContext(text, { line: 0, character: 16 });
      expect(ctx.kind).toBe("macro_param_key");
      expect((ctx as { prefix: string; macroName: string }).prefix).toBe("na");
      expect((ctx as { prefix: string; macroName: string }).macroName).toBe("Greeting");
    });

    test("returns none for plain text", () => {
      const text = "Just some text";
      const ctx = detectCompletionContext(text, { line: 0, character: 10 });
      expect(ctx.kind).toBe("none");
    });
  });

  describe("completeForContext", () => {
    function makeTestIndex(): DocumentIndex {
      const source = `
@meta
  title: Test
  author: John
@end

@anchor(section-intro)

@define(Greeting, name)
  Hello {{name}}!
@end

@define(Alert, message, type: "info")
  [{{type}}] {{message}}
@end
`;
      const ast = parse(source);
      return buildDocumentIndex("file:///test.ldoc", ast);
    }

    test("completes directives", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "directive", prefix: "def" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("@define");
    });

    test("completes all directives with empty prefix", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "directive", prefix: "" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("@document");
      expect(labels).toContain("@meta");
      expect(labels).toContain("@define");
      expect(labels).toContain("@use");
      expect(labels).toContain("@if");
      expect(labels).toContain("@foreach");
    });

    test("completes macro names", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "macro_name", prefix: "", directive: "use" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("Greeting");
      expect(labels).toContain("Alert");
    });

    test("completes macro names with prefix filter", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "macro_name", prefix: "Gre", directive: "use" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("Greeting");
      expect(labels).not.toContain("Alert");
    });

    test("completes macro parameter keys", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "macro_param_key", prefix: "", macroName: "Alert" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("type");
      expect(labels).toContain("message");
    });

    test("completes variables from @meta", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "variable", prefix: "" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("title");
      expect(labels).toContain("author");
    });

    test("completes variable filters", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "variable_filter", prefix: "" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("upper");
      expect(labels).toContain("lower");
      expect(labels).toContain("capitalize");
    });

    test("completes cross references (anchors)", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "cross_ref", prefix: "" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      const labels = items.map(i => i.label);
      expect(labels).toContain("section-intro");
    });

    test("returns empty for none context", () => {
      const index = makeTestIndex();
      const ctx: CompletionContext = { kind: "none" };
      const items = completeForContext(index, ctx, { snippetSupport: false });
      
      expect(items).toEqual([]);
    });
  });
});
