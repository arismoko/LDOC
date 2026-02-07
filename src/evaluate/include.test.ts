import { describe, expect, test } from "bun:test";
import { resolve as resolvePath } from "node:path";

import { compileToDocument } from "../pipeline/index.ts";
import type { Block, Paragraph } from "../types/document-ir.ts";

function paragraphText(block: Block): string {
  if (block.type !== "Paragraph") {
    return "";
  }

  return (block as Paragraph).content
    .filter((inline) => inline.type === "Text")
    .map((inline) => inline.value)
    .join("");
}

function createMapLoader(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const value = files[path];
    if (value === undefined) {
      throw new Error(`Missing fixture file: ${path}`);
    }
    return value;
  };
}

describe("include evaluation", () => {
  test("include expands child content with params args", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const loadFile = createMapLoader({
      [childPath]: `@params(names: ["name", "title"])
[Signer: $(data.name) - $(data.title)]
`,
    });

    const source = `[Start]
@include(path: "child.ldoc", args: { name: "Alice", title: "CEO" })
[End]
`;

    const { document, diagnostics } = await compileToDocument(source, {
      sourcePath: mainPath,
      loadFile,
    });

    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
    expect(document.blocks.length).toBe(3);
    expect(paragraphText(document.blocks[0]!)).toBe("Start");
    expect(paragraphText(document.blocks[1]!)).toBe("Signer: Alice - CEO");
    expect(paragraphText(document.blocks[2]!)).toBe("End");
  });

  test("include reports missing required params names", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const loadFile = createMapLoader({
      [childPath]: `@params(names: ["name", "title"])
[Signer]
`,
    });

    const source = `@include(path: "child.ldoc", args: { name: "Alice" })`;
    const { diagnostics } = await compileToDocument(source, {
      sourcePath: mainPath,
      loadFile,
    });

    expect(diagnostics.some((d) => d.code === "B007")).toBe(true);
  });

  test("include reports malformed @params declaration", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const loadFile = createMapLoader({
      [childPath]: `@params(names: [1, "ok"])
[Signer]
`,
    });

    const source = `@include(path: "child.ldoc", args: { ok: "yes" })`;
    const { diagnostics } = await compileToDocument(source, {
      sourcePath: mainPath,
      loadFile,
    });

    expect(diagnostics.some((d) => d.code === "P006")).toBe(true);
  });
});
