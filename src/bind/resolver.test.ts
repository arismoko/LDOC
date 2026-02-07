import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";

import { parseSource } from "../parse/index.ts";
import { resolveImports } from "./resolver.ts";

function createParseLoader(files: Record<string, string>) {
  return async (path: string) => {
    const source = files[path];
    if (source === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return parseSource(source);
  };
}

describe("import resolver", () => {
  test("collects imported paths from include directives", async () => {
    const basePath = "/virtual/main.ldoc";
    const importPath = resolvePath("/virtual", "child.ldoc");
    const loader = createParseLoader({
      [importPath]: "[Child]",
    });
    const cst = parseSource(`@include(path: "child.ldoc")`).cst;

    const result = await resolveImports(cst, {
      basePath,
      loadFile: loader,
    });

    expect(result.importedPaths.has(importPath)).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  test("reports include cycles", async () => {
    const basePath = "/virtual/main.ldoc";
    const aPath = resolvePath("/virtual", "a.ldoc");
    const bPath = resolvePath("/virtual", "b.ldoc");
    const loader = createParseLoader({
      [aPath]: `@include(path: "b.ldoc")`,
      [bPath]: `@include(path: "a.ldoc")`,
    });
    const cst = parseSource(`@include(path: "a.ldoc")`).cst;

    const result = await resolveImports(cst, {
      basePath,
      loadFile: loader,
    });

    expect(result.diagnostics.some((d) => d.code === "B006")).toBe(true);
  });
});
