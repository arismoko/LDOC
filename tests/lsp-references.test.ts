/**
 * LSP References and Diagnostics Tests
 */

import { describe, test, expect } from "bun:test";
import { buildSymbolUsages } from "../src/lsp/references";
import { buildDocumentIndex } from "../src/lsp/indexer";
import { parse } from "../src/parser/parser";
import { normalizeRefKey } from "../src/compiler/bookmark-utils";

describe("LSP References", () => {
  describe("buildSymbolUsages", () => {
    test("finds cross-reference usages", () => {
      const source = `
@anchor section-one

See [[section-one]] for details.

Also check [[section-one]] again.
`;
      const ast = parse(source);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      const key = normalizeRefKey("section-one");
      const refs = usages.anchorRefs.get(key);
      expect(refs).toBeDefined();
      expect(refs?.length).toBe(2);
    });

    test("finds macro usages", () => {
      const source = `
@define Greeting(name)
  Hello {{name}}!
@end

@use Greeting(name="World")
@use Greeting(name="Test")
`;
      const ast = parse(source);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      const refs = usages.macroRefs.get("Greeting");
      expect(refs).toBeDefined();
      expect(refs?.length).toBe(2);
    });

    test("finds variable usages", () => {
      const source = `
@meta
  title: Test Doc
@end

Document: {{title}}

Title again: {{title}}
`;
      const ast = parse(source);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      const refs = usages.variableRefs.get("title");
      expect(refs).toBeDefined();
      expect(refs?.length).toBe(2);
    });

    test("handles empty document", () => {
      const source = `// Just a comment`;
      const ast = parse(source);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      expect(usages.anchorRefs.size).toBe(0);
      expect(usages.macroRefs.size).toBe(0);
      expect(usages.variableRefs.size).toBe(0);
    });
  });

  describe("semantic diagnostics integration", () => {
    test("index tracks anchors for diagnostic matching", () => {
      const source = `
@anchor known-anchor

See [[known-anchor]] - this should not warn.
See [[unknown-anchor]] - this should warn.
`;
      const ast = parse(source);
      const index = buildDocumentIndex("file:///test.ldoc", ast);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      // Verify we can detect unknown anchors
      const knownKey = normalizeRefKey("known-anchor");
      const unknownKey = normalizeRefKey("unknown-anchor");
      
      expect(index.anchorsByKey.has(knownKey)).toBe(true);
      expect(index.anchorsByKey.has(unknownKey)).toBe(false);
      expect(usages.anchorRefs.has(knownKey)).toBe(true);
      expect(usages.anchorRefs.has(unknownKey)).toBe(true);
    });

    test("index tracks macros for diagnostic matching", () => {
      const source = `
@define KnownMacro()
  Content
@end

@use KnownMacro()
@use UnknownMacro()
`;
      const ast = parse(source);
      const index = buildDocumentIndex("file:///test.ldoc", ast);
      const usages = buildSymbolUsages("file:///test.ldoc", ast);
      
      expect(index.macros.has("KnownMacro")).toBe(true);
      expect(index.macros.has("UnknownMacro")).toBe(false);
      expect(usages.macroRefs.has("KnownMacro")).toBe(true);
      expect(usages.macroRefs.has("UnknownMacro")).toBe(true);
    });
  });
});
