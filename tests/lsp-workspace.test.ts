/**
 * LSP Workspace Tests
 * 
 * Tests for cross-file import resolution, completion, and diagnostics.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveImportedSymbols } from "../src/lsp/workspace";
import { completeForContext, type CompletionContext } from "../src/lsp/completion";
import { buildDocumentIndex } from "../src/lsp/indexer";
import { parse } from "../src/parser/parser";

describe("LSP Workspace", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ldoc-workspace-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeFile(name: string, content: string): Promise<string> {
    const path = join(tempDir, name);
    await Bun.write(path, content);
    return path;
  }

  describe("resolveImportedSymbols", () => {
    test("resolves macros from imported file", async () => {
      // Create library file with macro
      await writeFile("lib.ldoc", `
@define Alert(type, message)
  [{{type}}] {{message}}
@end

@define Notice(text)
  Note: {{text}}
@end
`);

      // Create main file that imports lib
      const mainPath = await writeFile("main.ldoc", `
@import "lib.ldoc"

@use Alert(type="info", message="Hello")
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.macros.has("Alert")).toBe(true);
      expect(imported.macros.has("Notice")).toBe(true);
      expect(imported.errors).toEqual([]);
    });

    test("resolves anchors from imported file", async () => {
      await writeFile("anchors.ldoc", `
@anchor section-intro
Introduction content.

@anchor section-details
Details content.
`);

      const mainPath = await writeFile("main2.ldoc", `
@import "anchors.ldoc"

See [[section-intro]].
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.anchors.has("section-intro")).toBe(true);
      expect(imported.anchors.has("section-details")).toBe(true);
    });

    test("handles nested imports", async () => {
      await writeFile("base.ldoc", `
@define BaseMacro()
  Base content
@end
`);

      await writeFile("middle.ldoc", `
@import "base.ldoc"

@define MiddleMacro()
  Middle content
@end
`);

      const mainPath = await writeFile("main3.ldoc", `
@import "middle.ldoc"

@use BaseMacro()
@use MiddleMacro()
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.macros.has("BaseMacro")).toBe(true);
      expect(imported.macros.has("MiddleMacro")).toBe(true);
    });

    test("detects import cycles", async () => {
      await writeFile("cycle-a.ldoc", `
@import "cycle-b.ldoc"
`);

      await writeFile("cycle-b.ldoc", `
@import "cycle-a.ldoc"
`);

      const mainPath = await writeFile("main-cycle.ldoc", `
@import "cycle-a.ldoc"
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.errors.some(e => e.includes("cycle"))).toBe(true);
    });

    test("reports missing import files", async () => {
      const mainPath = await writeFile("main-missing.ldoc", `
@import "nonexistent.ldoc"
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.errors.some(e => e.includes("not found"))).toBe(true);
    });

    test("handles file without imports", async () => {
      const mainPath = await writeFile("no-imports.ldoc", `
@define LocalMacro()
  Content
@end
`);

      const ast = parse(await Bun.file(mainPath).text(), { sourcePath: mainPath });
      const imported = await resolveImportedSymbols(ast, mainPath);

      expect(imported.macros.size).toBe(0);
      expect(imported.anchors.size).toBe(0);
      expect(imported.errors).toEqual([]);
    });
  });

  describe("completeForContext with imports", () => {
    test("includes imported macros in completion", async () => {
      await writeFile("macros.ldoc", `
@define ImportedMacro(arg)
  {{arg}}
@end
`);

      const mainPath = await writeFile("main-complete.ldoc", `
@import "macros.ldoc"

@define LocalMacro()
  Local
@end
`);

      const text = await Bun.file(mainPath).text();
      const ast = parse(text, { sourcePath: mainPath });
      const index = buildDocumentIndex(pathToFileURL(mainPath).toString(), ast);
      const imported = await resolveImportedSymbols(ast, mainPath);

      const ctx: CompletionContext = { kind: "macro_name", prefix: "", directive: "use" };
      const items = completeForContext(index, ctx, { snippetSupport: false }, imported);

      const labels = items.map(i => i.label);
      expect(labels).toContain("LocalMacro");
      expect(labels).toContain("ImportedMacro");

      // Imported macro should have "(imported)" in detail
      const importedItem = items.find(i => i.label === "ImportedMacro");
      expect(importedItem?.detail).toContain("imported");
    });

    test("includes imported anchors in cross-ref completion", async () => {
      await writeFile("sections.ldoc", `
@anchor imported-section
Imported section content.
`);

      const mainPath = await writeFile("main-crossref.ldoc", `
@import "sections.ldoc"

@anchor local-section
Local section content.
`);

      const text = await Bun.file(mainPath).text();
      const ast = parse(text, { sourcePath: mainPath });
      const index = buildDocumentIndex(pathToFileURL(mainPath).toString(), ast);
      const imported = await resolveImportedSymbols(ast, mainPath);

      const ctx: CompletionContext = { kind: "cross_ref", prefix: "" };
      const items = completeForContext(index, ctx, { snippetSupport: false }, imported);

      const labels = items.map(i => i.label);
      expect(labels).toContain("local-section");
      expect(labels).toContain("imported-section");

      // Imported anchor should have "(imported)" in detail
      const importedItem = items.find(i => i.label === "imported-section");
      expect(importedItem?.detail).toContain("imported");
    });

    test("completes imported macro parameter keys", async () => {
      await writeFile("params.ldoc", `
@define ParamMacro(required, optional="default")
  {{required}} {{optional}}
@end
`);

      const mainPath = await writeFile("main-params.ldoc", `
@import "params.ldoc"
`);

      const text = await Bun.file(mainPath).text();
      const ast = parse(text, { sourcePath: mainPath });
      const index = buildDocumentIndex(pathToFileURL(mainPath).toString(), ast);
      const imported = await resolveImportedSymbols(ast, mainPath);

      const ctx: CompletionContext = { kind: "macro_param_key", prefix: "", macroName: "ParamMacro" };
      const items = completeForContext(index, ctx, { snippetSupport: false }, imported);

      const labels = items.map(i => i.label);
      expect(labels).toContain("required");
      expect(labels).toContain("optional");
    });

    test("local macros shadow imported macros", async () => {
      await writeFile("shadow-lib.ldoc", `
@define ShadowedMacro()
  Imported version
@end
`);

      const mainPath = await writeFile("main-shadow.ldoc", `
@import "shadow-lib.ldoc"

@define ShadowedMacro()
  Local version
@end
`);

      const text = await Bun.file(mainPath).text();
      const ast = parse(text, { sourcePath: mainPath });
      const index = buildDocumentIndex(pathToFileURL(mainPath).toString(), ast);
      const imported = await resolveImportedSymbols(ast, mainPath);

      const ctx: CompletionContext = { kind: "macro_name", prefix: "", directive: "use" };
      const items = completeForContext(index, ctx, { snippetSupport: false }, imported);

      // Should only have one ShadowedMacro (the local one)
      const shadowedItems = items.filter(i => i.label === "ShadowedMacro");
      expect(shadowedItems.length).toBe(1);
      expect(shadowedItems[0]?.detail).not.toContain("imported");
    });
  });
});
