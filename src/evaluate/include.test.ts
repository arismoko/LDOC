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
@def(secret: "S")
[Signer]
`,
    });

    const source = `@include(path: "child.ldoc", args: { name: "Alice" })
[secret: $(defs.secret)]`;
    // B007 is now caught at bind phase — compileToDocument throws
    await expect(
      compileToDocument(source, {
        sourcePath: mainPath,
        loadFile,
      }),
    ).rejects.toThrow("Missing include arg 'title'");
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
    // P006 is now caught at bind phase — compileToDocument throws
    await expect(
      compileToDocument(source, {
        sourcePath: mainPath,
        loadFile,
      }),
    ).rejects.toThrow("@params names must be an array of non-empty strings");
  });

  test("include rejects paths that escape include root", async () => {
    const source = `@include(path: "../outside.ldoc")`;
    await expect(
      compileToDocument(source, {
        sourcePath: "/virtual/root/main.ldoc",
        loadFile: createMapLoader({
          [resolvePath("/virtual", "outside.ldoc")]: "[outside]",
        }),
      }),
    ).rejects.toThrow("escapes include root");
  });

  test("include rejects absolute paths", async () => {
    const source = `@include(path: "/etc/passwd")`;
    await expect(
      compileToDocument(source, {
        sourcePath: "/virtual/main.ldoc",
        loadFile: createMapLoader({}),
      }),
    ).rejects.toThrow("Absolute include paths are not allowed");
  });

  test("nested include refs do not emit false B009 warnings", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const grandPath = resolvePath("/virtual", "grand.ldoc");
    const loadFile = createMapLoader({
      [childPath]: `@include(path: "grand.ldoc")
[@ref(id: "grand-anchor")]`,
      [grandPath]: `@anchor(id: "grand-anchor")
[Grand section]`,
    });

    const source = `@include(path: "child.ldoc")`;
    const { diagnostics } = await compileToDocument(source, {
      sourcePath: mainPath,
      loadFile,
    });

    expect(diagnostics.some((d) => d.code === "B009")).toBe(false);
  });

  test("inline footnotes preserve encounter order across include boundaries", async () => {
    const mainPath = "/virtual/main.ldoc";
    const childPath = resolvePath("/virtual", "child.ldoc");
    const loadFile = createMapLoader({
      [childPath]: `[Child text@footnote{Child note}.]\n`,
    });

    const source = `[Parent text@footnote{Parent note}.]
@include(path: "child.ldoc")
`;

    const { document, diagnostics } = await compileToDocument(source, {
      sourcePath: mainPath,
      loadFile,
    });

    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    const footnotes = document.blocks.filter((b) => b.type === "Footnote");
    expect(footnotes.length).toBe(2);

    const first = footnotes[0];
    const second = footnotes[1];
    expect(first?.type).toBe("Footnote");
    expect(second?.type).toBe("Footnote");
    if (first?.type === "Footnote") {
      expect(paragraphText(first.content[0]!)).toBe("Parent note");
    }
    if (second?.type === "Footnote") {
      expect(paragraphText(second.content[0]!)).toBe("Child note");
    }
  });
});
