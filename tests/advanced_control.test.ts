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

describe("Advanced Control Flow", () => {
  test("@elseif chain works", async () => {
    const ldoc = `
@meta
  score: 75

@if(score >= 90)
  Grade: A
@elseif(score >= 80)
  Grade: B
@elseif(score >= 70)
  Grade: C
@else
  Grade: F
@end
`;
    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);
    expect(text).toContain("Grade: C");
    expect(text).not.toContain("Grade: A");
    expect(text).not.toContain("Grade: B");
    expect(text).not.toContain("Grade: F");
  });

  test("loop metadata works", async () => {
    const ldoc = `
@meta
  items: a, b, c

@foreach(item, in: items)
  Item {{loop.count}}/{{loop.length}}: {{item}} (Index: {{loop.index}})
  @if(loop.first)
    *Start*
  @end
  @if(loop.last)
    *End*
  @end
@end
`;
    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);
    
    // Split by "Item" to check each iteration's content
    // text looks like: "Item 1/3: a...StartItem 2/3: b...Item 3/3: c...End"
    const parts = text.split("Item");
    // parts[0] is empty or preamble
    // parts[1] is first item
    // parts[2] is second item
    // parts[3] is third item

    expect(parts[1]).toContain("1/3: a");
    expect(parts[1]).toContain("Start");
    
    expect(parts[2]).toContain("2/3: b");
    expect(parts[2]).not.toContain("Start");
    expect(parts[2]).not.toContain("End");
    
    expect(parts[3]).toContain("3/3: c");
    expect(parts[3]).toContain("End");
  });
});
