import { test, expect, describe } from "bun:test";
import { Lexer, TokenType } from "../src/parser/lexer";
import { Parser } from "../src/parser/parser";
import { DocxCompiler } from "../src/compiler/docx";
import JSZip from "jszip";
import { resolve } from "node:path";

function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error("Expected value to be defined");
  }
  return value as NonNullable<T>;
}

describe("Lexer", () => {
  test("tokenizes numbered items with levels", () => {
    const lexer = new Lexer("@1 First\n@@a Second\n@@@i Third");
    const tokens = lexer.tokenize();

    const numbered = tokens.filter((t) => t.type === TokenType.NUMBERED_ITEM);
    expect(numbered).toHaveLength(3);
    const n0 = must(numbered[0]);
    const n1 = must(numbered[1]);
    const n2 = must(numbered[2]);
    expect(n0.level).toBe(1);
    expect(n0.style).toBe("1");
    expect(n1.level).toBe(2);
    expect(n1.style).toBe("a");
    expect(n2.level).toBe(3);
    expect(n2.style).toBe("i");
  });

  test("tokenizes modifiers", () => {
    const lexer = new Lexer("@center @bold Hello");
    const tokens = lexer.tokenize();

    const modifiers = tokens.filter((t) => t.type === TokenType.MODIFIER);
    expect(modifiers).toHaveLength(2);
    const m0 = must(modifiers[0]);
    const m1 = must(modifiers[1]);
    expect(m0.value).toBe("center");
    expect(m1.value).toBe("bold");
  });

  test("tokenizes variables", () => {
    const lexer = new Lexer("Hello {{name}} and {{property.address}}");
    const tokens = lexer.tokenize();

    const vars = tokens.filter((t) => t.type === TokenType.VARIABLE);
    expect(vars).toHaveLength(2);
    const v0 = must(vars[0]);
    const v1 = must(vars[1]);
    expect(v0.value).toBe("name");
    expect(v1.value).toBe("property.address");
  });

  test("tokenizes headers", () => {
    const lexer = new Lexer("# Heading 1\n## Heading 2\n### Heading 3");
    const tokens = lexer.tokenize();

    const headers = tokens.filter((t) => t.type === TokenType.HEADER);
    expect(headers).toHaveLength(3);
    const h0 = must(headers[0]);
    const h1 = must(headers[1]);
    const h2 = must(headers[2]);
    expect(h0.level).toBe(1);
    expect(h1.level).toBe(2);
    expect(h2.level).toBe(3);
  });

  test("tokenizes bullets", () => {
    const lexer = new Lexer("@- Item 1\n@@- Item 2");
    const tokens = lexer.tokenize();

    const bullets = tokens.filter((t) => t.type === TokenType.BULLET);
    expect(bullets).toHaveLength(2);
    const b0 = must(bullets[0]);
    const b1 = must(bullets[1]);
    expect(b0.level).toBe(1);
    expect(b1.level).toBe(2);
  });

  test("tokenizes emphasis", () => {
    const lexer = new Lexer("**bold** and *italic* and ***both***");
    const tokens = lexer.tokenize();

    expect(tokens.some((t) => t.type === TokenType.BOLD)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.ITALIC)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.BOLD_ITALIC)).toBe(true);
  });

  test("tokenizes modifier counts", () => {
    const lexer = new Lexer("@indent:2\n@outdent:3\n@indent 2\n");
    const tokens = lexer.tokenize();

    const mods = tokens.filter((t) => t.type === TokenType.MODIFIER);
    expect(mods).toHaveLength(3);
    const md0 = must(mods[0]);
    const md1 = must(mods[1]);
    const md2 = must(mods[2]);
    expect(md0.value).toBe("indent");
    expect(md0.count).toBe(2);
    expect(md1.value).toBe("outdent");
    expect(md1.count).toBe(3);
    expect(md2.value).toBe("indent");
    expect(md2.count).toBe(2);
  });

  test("tokenizes explicit end-block sentinel", () => {
    const lexer = new Lexer("@box\n  Hello\n  @;\nWorld\n");
    const tokens = lexer.tokenize();
    expect(tokens.some((t) => t.type === TokenType.END_BLOCK)).toBe(true);
  });

  test("tokenizes define and use", () => {
    const lexer = new Lexer("@define Foo\n  Hello\n@use Foo\n");
    const tokens = lexer.tokenize();
    expect(tokens.some((t) => t.type === TokenType.DEFINE)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.USE)).toBe(true);
  });
});

describe("Parser", () => {
  test("@document must be a block", () => {
    const parser = new Parser();
    expect(() => parser.parse("@document My Agreement\n\nHello world")).toThrow(/@document must be a block/);
  });

  test("parses @anchor", () => {
    const parser = new Parser();
    const ast = parser.parse("@anchor Foo\n# Heading\n");
    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("anchor");
    expect((n0 as any).name).toBe("Foo");
  });

  test("parses numbered items with children", () => {
    const parser = new Parser();
    const ast = parser.parse(`@1 First item
@@a Sub item one
@@b Sub item two
@2 Second item`);

    const numbered = ast.body.filter((n) => n.type === "numbered_item");
    expect(numbered).toHaveLength(4);
  });

  test("parses modifiers", () => {
    const parser = new Parser();
    const ast = parser.parse("@center Hello world");

    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("modifier");
    const modifier = n0 as any;
    expect(modifier.modifier).toBe("center");
  });

  test("parses variables in content", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello {{name}}");

    const para = must(ast.body[0]) as any;
    expect(para.type).toBe("paragraph");
    expect(para.content.some((n: any) => n.type === "variable")).toBe(true);
  });

  test("soft-wraps single newlines within paragraphs", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello\nWorld");
    expect(ast.body).toHaveLength(1);
    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("paragraph");
    const p: any = n0;
    const text = p.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toBe("Hello World");
  });

  test("soft-wraps single newlines within list item content", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 Hello\nWorld\n\n@2 Next");
    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("numbered_item");
    const item: any = n0;
    const text = item.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toBe("Hello World");
  });

  test("@1 with empty line uses first indented paragraph as content", () => {
    const parser = new Parser();
    const ast = parser.parse("@1\n  Hello\n  World\n@2 Next");
    const item: any = must(ast.body[0]);
    expect(item.type).toBe("numbered_item");
    const text = item.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toBe("Hello World");
  });

  test("parses meta block", () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta
  date: January 1, 2026
  parties:
    seller: Acme Corp

Hello world`);

    expect(ast.meta).toBeDefined();
    expect(ast.meta?.data.date).toBe("January 1, 2026");
    expect(ast.meta?.data.parties).toEqual({ seller: "Acme Corp" });
  });

  test("parses deeply nested meta blocks", () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta
  level1:
    level2:
      level3: deep value
  other: top`);

    expect(ast.meta).toBeDefined();
    expect(ast.meta?.data.level1?.level2?.level3).toBe("deep value");
    expect(ast.meta?.data.other).toBe("top");
  });

  test("handles empty meta values without nested block", () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta
  emptykey:
  nextkey: value`);

    expect(ast.meta).toBeDefined();
    expect(ast.meta?.data.emptykey).toBe("");
    expect(ast.meta?.data.nextkey).toBe("value");
  });

  test("preserves blank lines as spacing", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello\n\nWorld");

    const n0 = must(ast.body[0]);
    const n1 = must(ast.body[1]);
    const n2 = must(ast.body[2]);
    expect(n0.type).toBe("paragraph");
    expect(n1.type).toBe("empty_paragraph");
    expect((n1 as any).count).toBe(1);
    expect(n2.type).toBe("paragraph");
  });

  test("preserves blank lines between list item and following paragraph", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 One\n\nTwo");
    const n0 = must(ast.body[0]);
    const n1 = must(ast.body[1]);
    const n2 = must(ast.body[2]);
    expect(n0.type).toBe("numbered_item");
    expect(n1.type).toBe("empty_paragraph");
    expect((n1 as any).count).toBe(1);
    expect(n2.type).toBe("paragraph");
  });

  test("preserves blank lines inside modifier blocks", () => {
    const parser = new Parser();
    const ast = parser.parse("@center\n  Hello\n\n  World\n");
    expect(must(ast.body[0]).type).toBe("modifier");
    const m: any = must(ast.body[0]);
    // content should include: paragraph, empty_paragraph, paragraph
    expect(must(m.content[0]).type).toBe("paragraph");
    expect(must(m.content[1]).type).toBe("empty_paragraph");
    expect(must(m.content[2]).type).toBe("paragraph");
  });

  test("@; closes modifier block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@box\n  In box\n@;\nOutside\n");
    expect(must(ast.body[0]).type).toBe("modifier");
    const m: any = must(ast.body[0]);
    expect(m.modifier).toBe("box");
    expect(must(m.content[0]).type).toBe("paragraph");
    expect(must(ast.body[1]).type).toBe("paragraph");
  });

  test("@; closes @meta block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@meta\n  a: 1\n@;\nHello\n");
    expect(ast.meta?.data.a).toBe("1");
    expect(must(ast.body[0]).type).toBe("paragraph");
  });

  test("@; closes @table block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [A]\n@;\nHello\n");
    expect(must(ast.body[0]).type).toBe("table");
    const t: any = must(ast.body[0]);
    expect(t.rows.length).toBe(1);
    expect(must(ast.body[1]).type).toBe("paragraph");
  });

  test("@; at top-level is an error", () => {
    const parser = new Parser();
    expect(() => parser.parse("@;\n")).toThrow(/Unmatched @;/);
  });

  test("parses @define and @use", () => {
    const parser = new Parser();
    const ast = parser.parse("@define Foo\n  Hello\n\n# Title\n\n@use Foo\n");
    expect(must(ast.body[0]).type).toBe("define");
    expect((must(ast.body[0]) as any).name).toBe("Foo");
    expect((must(ast.body[0]) as any).template.length).toBeGreaterThan(0);
    expect(ast.body.some((n: any) => n.type === "use")).toBe(true);
  });

  test("parses @define params and @use args", () => {
    const parser = new Parser();
    const ast = parser.parse("@define Notice(title, subject)\n  Hello\n\n@use Notice(title=\"T\", subject=S)\n");
    const def: any = ast.body[0];
    const use: any = ast.body.find((n: any) => n.type === "use");
    expect(def.params).toEqual(["title", "subject"]);
    expect(use.args.title).toBe("T");
    expect(use.args.subject).toBe("S");
  });

  test("parses @if/@else/@end", () => {
    const parser = new Parser();
    const ast = parser.parse(`@if true
  Hello
@else
  World
@end
`);

    expect(must(ast.body[0]).type).toBe("if");
    const n: any = must(ast.body[0]);
    expect(n.condition).toBe("true");
    expect(n.thenBranch.length).toBeGreaterThan(0);
    expect(n.elseBranch.length).toBeGreaterThan(0);
  });

  test("parses @repeat", () => {
    const parser = new Parser();
    const ast = parser.parse(`@repeat 3
  Hello
 @end
`);
    expect(must(ast.body[0]).type).toBe("repeat");
    const r: any = must(ast.body[0]);
    expect(r.count).toBe(3);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test("rejects @repeat without @end", () => {
    const parser = new Parser();
    expect(() => parser.parse("@repeat 2\n  x\n")).toThrow(/@repeat missing @end/);
  });

  test("rejects @repeat above max", () => {
    const parser = new Parser();
    expect(() => parser.parse("@repeat 101\n  x\n@end\n")).toThrow(/exceeds maximum/);
  });

  test("rejects @repeat closed with @;", () => {
    const parser = new Parser();
    expect(() => parser.parse("@repeat 1\n  x\n@;\n@end\n")).toThrow(/cannot close @repeat/);
  });

  test("parses @foreach", () => {
    const parser = new Parser();
    const ast = parser.parse(`@foreach item in items
  {{item}}
@end
`);

    expect(must(ast.body[0]).type).toBe("foreach");
    const f: any = must(ast.body[0]);
    expect(f.item).toBe("item");
    expect(f.iterable).toBe("items");
    expect(f.body.length).toBeGreaterThan(0);
  });

  test("rejects @foreach without @end", () => {
    const parser = new Parser();
    expect(() => parser.parse("@foreach x in items\n  y\n")).toThrow(/@foreach missing @end/);
  });

  test("rejects @else without @if", () => {
    const parser = new Parser();
    expect(() => parser.parse("@else\n  x\n@end\n")).toThrow(/Unmatched @else/);
  });

  test("rejects @end without @if", () => {
    const parser = new Parser();
    expect(() => parser.parse("@end\n")).toThrow(/Unmatched @end/);
  });

  test("rejects @if without @end", () => {
    const parser = new Parser();
    expect(() => parser.parse("@if true\n  x\n")).toThrow(/missing @end/i);
  });
});

describe("Compiler", () => {
  test("compiles simple document to DOCX buffer", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  title: Test Document

# Introduction

This is a test paragraph.

@1 First item
@2 Second item`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // DOCX files start with PK (ZIP signature)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  test("@document does not auto-render a visible title", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document\n  title: Hidden Title\n\nBody text.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("Body text.");
    expect(xml).not.toContain("HIDDEN TITLE");
  });

  test("@document block provides {{document.*}} variables", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document\n  title: My Doc\n  short_title: Short\n\nHello {{document.title}} / {{document.short_title}}.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    const text = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g))
      .map((m) => m[1])
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    expect(text).toMatch(/Hello.*My Doc.*Short\./);
  });

  test("resolves variables from meta", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta
  name: John Doe

Hello {{name}}`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("creates bookmarks and internal hyperlinks for cross refs", async () => {
    const parser = new Parser();
    const ast = parser.parse(`# EXHIBIT B\n\nSee [[EXHIBIT B]].`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
    expect(xml).toContain("w:anchor=");
  });

  test("throws on unresolved cross refs", async () => {
    const parser = new Parser();
    const ast = parser.parse("See [[DOES_NOT_EXIST]].");
    const compiler = new DocxCompiler();

    await expect(compiler.compile(ast)).rejects.toThrow(/Unresolved cross-references/);
  });

  test("@anchor creates a bookmark target for [[...]]", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@anchor target\nBody.\n\nSee [[target]].`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
    expect(xml).toContain("w:anchor=");
  });

  test("@define does not render; @use expands", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define Block\n  @box\n    Hi\n\n# Title\n\n@use Block\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    // Should contain box table from the used block
    expect(xml).toContain("w:tbl");
    // Should not contain literal '@define'
    expect(xml).not.toContain("@define");
  });

  test("@use substitutes params into {{param}}", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define Box(title)\n  @box\n    **{{title}}**\n\n@use Box(title=\"Hello\")\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("Hello");
  });

  test("template anchors work without explicit label (auto-label sugar)", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define T()\n  @anchor a\n  Hello\n  See [[a]].\n\n@use T()\n@use T()\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
  });

  test("scoped anchors inside templates do not collide", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define T()\n  @anchor a\n  Hello\n  See [[a]].\n\n@use T() as X\n@use T() as Y\nSee [[X.a]] and [[Y.a]].\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
  });

  test("@use requires all declared params (no fallback to @meta)", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta\n  title: FromMeta\n\n@define Box(title)\n  {{title}}\n\n@use Box()\n`);
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/missing required param/);
  });

  test("@use rejects unknown params", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define Box(title)\n  Hi\n\n@use Box(nope=1)\n`);
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/unknown param/);
  });

  test("detects recursive @use", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define A\n  @use A\n\n@use A\n`);
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/Recursive @use/);
  });

  test("@import loads defines from another file", async () => {
    const mainPath = resolve(process.cwd(), "tests/fixtures/imports/main.ldoc");
    const input = await Bun.file(mainPath).text();
    const ast = new Parser().parse(input, { sourcePath: mainPath });
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("Imported clause");
  });

  test("@import detects cycles", async () => {
    const mainPath = resolve(process.cwd(), "tests/fixtures/imports/cycle-a.ldoc");
    const input = await Bun.file(mainPath).text();
    const ast = new Parser().parse(input, { sourcePath: mainPath });
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/Import cycle detected/);
  });

  test("@import missing file errors", async () => {
    const mainPath = resolve(process.cwd(), "tests/fixtures/imports/main.ldoc");
    const input = `@document\n  title: X\n\n@import ./nope.ldoc\n`;
    const ast = new Parser().parse(input, { sourcePath: mainPath });
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/Import not found/);
  });

  test("throws on unknown @use", async () => {
    const parser = new Parser();
    const ast = parser.parse("@use Missing\n");
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/Unknown @use/);
  });

  test("@anchor skips comments and blank lines", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@anchor a\n// comment\n\nBody.\nSee [[a]].`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
  });

  test("throws on unresolved variables unless allow_undefined", async () => {
    const parser = new Parser();
    const ast = parser.parse("Hello {{missing.var}}.");
    const compiler = new DocxCompiler();
    await expect(compiler.compile(ast)).rejects.toThrow(/Unresolved variables/);
  });

  test("allow_undefined disables unresolved variable and ref errors", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document\n  allow_undefined: true\n\nHello {{missing.var}} and [[nope]].`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    expect(buffer.length).toBeGreaterThan(0);
  });

  test("writes default and first-page headers with page numbers", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@header
  Page {{page}} of {{pages}}

@firstpage @header
  FIRST PAGE {{page}}

# Title

Body.`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);

    // Ensure header parts exist
    const headerFiles = Object.keys(zip.files).filter((p) => p.startsWith("word/header") && p.endsWith(".xml"));
    expect(headerFiles.length).toBeGreaterThan(0);

    // Section should reference first header
    const docXml = await zip.file("word/document.xml")!.async("text");
    expect(docXml).toContain("w:titlePg");
  });

  test("applies @margins to section properties", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@margins 1in 2in 3in 4in\n\nBody.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toMatch(/w:pgMar[^>]*w:top=\"1440\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:right=\"2880\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:bottom=\"4320\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:left=\"5760\"/);
  });

  test("applies @landscape to page size", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@landscape\n\nBody.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toMatch(/w:pgSz[^>]*w:orient=\"landscape\"/);
  });

  test("applies @spacing to default paragraph style", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@spacing 1.5 before=6pt after=12pt\n\nBody.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toMatch(/w:spacing[^>]*w:line=\"360\"/);
    expect(xml).toMatch(/w:spacing[^>]*w:before=\"120\"/);
    expect(xml).toMatch(/w:spacing[^>]*w:after=\"240\"/);
  });

  test("@box renders as single-cell table with borders", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@box\n  **NOTICE:** Important.\n  Read carefully.\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toContain("w:tbl");
    expect(xml).toContain("w:tblBorders");
    expect(xml).toContain("w:shd");
    expect(xml).toContain("F5F5F5");
    expect(xml).toContain("999999");
  });

  test("@repeat expands N times", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@repeat 3\n  Hi\n@end\nDone\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    const text = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)).map((m) => m[1]);
    const hiCount = text.filter((t) => t === "Hi").length;
    expect(hiCount).toBe(3);
    expect(text.join(" ")).toContain("Done");
  });

  test("@repeat 0 emits nothing", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@repeat 0\n  Hi\n@end\nDone\n`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).not.toContain(">Hi<");
    expect(xml).toContain("Done");
  });

  test("@foreach iterates comma-separated string param", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@define L(items)
  @foreach item in items
    {{item}}
  @end

@use L(items="a,b,c")
`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    const text = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g)).map((m) => m[1]);
    expect(text.join(" ")).toContain("a");
    expect(text.join(" ")).toContain("b");
    expect(text.join(" ")).toContain("c");
  });

  test("@foreach iterates object keys", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@meta
  items:
    apple: 1
    banana: 2

@foreach k in items
  {{k}}
@end
`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toContain("apple");
    expect(xml).toContain("banana");
  });
});
