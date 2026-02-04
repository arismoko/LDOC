import { describe, test, expect } from "bun:test";
import { Parser } from "../src/parser/parser";
import { DocxCompiler } from "../src/compiler/docx";
import JSZip from "jszip";

async function compileToDocxBuffer(ldoc: string): Promise<Buffer> {
  const parser = new Parser();
  const ast = parser.parse(ldoc);
  const compiler = new DocxCompiler();
  return compiler.compile(ast);
}

async function readZipText(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) throw new Error(`File not found: ${path}`);
  return file.async("text");
}

function joinTextRuns(xml: string): string {
  const matches = xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g);
  return Array.from(matches).map((m) => m[1]).join("");
}

describe("Enhanced Macros", () => {
  test("default parameters work", async () => {
    const ldoc = `
@define Greeting(name="World")
  Hello {{name}}!

@use Greeting()
@use Greeting(name="Alice")
`;
    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);
    expect(text).toContain("Hello World!");
    expect(text).toContain("Hello Alice!");
  });

  test("content blocks via @slot work", async () => {
    const ldoc = `
@define Box(title)
  # {{title}}
  @slot
  End of box.

@use Box(title="My Box")
  This is content inside the box.
  It can have multiple paragraphs.
@end
`;
    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);
    
    expect(text).toContain("My Box");
    expect(text).toContain("This is content inside the box.");
    expect(text).toContain("It can have multiple paragraphs.");
    expect(text).toContain("End of box.");
  });

  test("content blocks with nested macros", async () => {
    const ldoc = `
@define Wrapper()
  Start Wrapper
  @slot
  End Wrapper

@define Inner()
  Inner Content

@use Wrapper()
  @use Inner()
@end
`;
    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);
    
    expect(text).toContain("Start Wrapper");
    expect(text).toContain("Inner Content");
    expect(text).toContain("End Wrapper");
  });
});
