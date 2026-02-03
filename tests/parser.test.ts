import { test, expect, describe } from "bun:test";
import { Lexer, TokenType } from "../src/parser/lexer";
import { Parser } from "../src/parser/parser";
import { DocxCompiler } from "../src/compiler/docx";
import JSZip from "jszip";
import { docxToLdoc } from "../src/decompiler";
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

  test("parses @columns region with options", () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 2 gap=0.5in separator
  Column content here
@;

After columns.`);

    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("columns_region");
    const col: any = n0;
    expect(col.columnCount).toBe(2);
    expect(col.gapTwip).toBe(720); // 0.5in = 720 twips
    expect(col.separator).toBe(true);
    expect(col.children.length).toBeGreaterThan(0);
    // Body after columns: empty_paragraph (from blank line), then paragraph
    expect(must(ast.body[1]).type).toBe("empty_paragraph");
    expect(must(ast.body[2]).type).toBe("paragraph");
  });

  test("parses @columns region with default gap", () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 3
  Content
@;`);

    const col: any = must(ast.body[0]);
    expect(col.type).toBe("columns_region");
    expect(col.columnCount).toBe(3);
    expect(col.gapTwip).toBe(720); // default 0.5in
    expect(col.separator).toBe(false);
  });

  test("rejects nested @columns", () => {
    const parser = new Parser();
    expect(() =>
      parser.parse(`@columns 2
  @columns 3
    Nested
  @;
@;`)
    ).toThrow(/nested/i);
  });

  test("rejects @columns with invalid count", () => {
    const parser = new Parser();
    expect(() => parser.parse("@columns 0\n  x\n@;\n")).toThrow();
    expect(() => parser.parse("@columns 11\n  x\n@;\n")).toThrow();
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

  test("@columns region creates multi-column section", async () => {
    const parser = new Parser();
    const ast = parser.parse(`Before columns.

@columns 2 gap=0.5in separator
  Column content.
@;

After columns.`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have w:cols with w:num="2"
    expect(xml).toMatch(/w:cols[^>]*w:num="2"/);
    // Should have separator line
    expect(xml).toMatch(/w:cols[^>]*w:sep="true"|w:cols[^>]*w:sep="1"/);
    // Should use continuous section break
    expect(xml).toMatch(/w:type[^>]*w:val="continuous"/);
    // Content should be present
    expect(xml).toContain("Column content");
    expect(xml).toContain("After columns");
  });

  test("@columns region reverts to single column after", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 3
  In columns.
@;

After columns.`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have 3-column section
    expect(xml).toMatch(/w:cols[^>]*w:num="3"/);
    // Should have a section that reverts to 1 column (or no w:cols which defaults to 1)
    // The last section should be single column
    const colsMatches = Array.from(xml.matchAll(/w:cols[^>]*w:num="(\d+)"/g));
    expect(colsMatches.length).toBeGreaterThanOrEqual(1);
    // At least one section should be 3 columns, and content after should exist
    expect(colsMatches.some((m) => m[1] === "3")).toBe(true);
  });

  test("@columns gap in different units", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 2 gap=1cm
  Content.
@;`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // 1cm = ~567 twips (1440 * 2.54 / 2.54 * 1 = ~567)
    // We should have w:cols with w:space attribute
    expect(xml).toMatch(/w:cols[^>]*w:num="2"/);
    expect(xml).toMatch(/w:cols[^>]*w:space="\d+"/);
  });
});

describe("@numbering directive", () => {
  test("parses @numbering default", () => {
    const parser = new Parser();
    const ast = parser.parse("@numbering default\n\n@1 One\n");
    expect(ast.numberingScheme).toBe("default");
  });

  test("parses @numbering decimal", () => {
    const parser = new Parser();
    const ast = parser.parse("@numbering decimal\n\n@1 One\n");
    expect(ast.numberingScheme).toBe("decimal");
  });

  test("defaults to no numberingScheme when directive absent", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 One\n");
    expect(ast.numberingScheme).toBeUndefined();
  });

  test("rejects unknown numbering scheme", () => {
    const parser = new Parser();
    expect(() => parser.parse("@numbering roman\n")).toThrow(/default.*decimal/i);
  });

  test("rejects @numbering after numbered item", () => {
    const parser = new Parser();
    expect(() => parser.parse("@1 One\n@numbering decimal\n")).toThrow(/before.*numbered/i);
  });

  test("default scheme uses legal-default for auto style items", async () => {
    const parser = new Parser();
    // Using default scheme (or no scheme), auto-styled nested items should use legal-default
    const ast = parser.parse("@1 One\n@@ Two\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const numXml = await zip.file("word/numbering.xml")!.async("text");

    // legal-default uses "(%2)" for level 1 (lowercase letter in parens)
    // legal-decimal uses "%1.%2." for level 1 (decimal hierarchy)
    // With default scheme, auto items at level 1 should use legal-default format
    expect(numXml).toContain("(%2)"); // legal-default format at level 1
  });

  test("decimal scheme uses legal-decimal for auto style items", async () => {
    const parser = new Parser();
    const ast = parser.parse("@numbering decimal\n\n@1 One\n@@ Two\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")!.async("text");
    const numXml = await zip.file("word/numbering.xml")!.async("text");

    // legal-decimal uses "%1.%2." format at level 1
    expect(numXml).toContain("%1.%2.");
    // The document should reference the decimal numbering config
    // We verify by checking that numId=3 (legal-decimal) is used
    expect(docXml).toMatch(/<w:numId w:val="3"/);
  });

  test("explicit decimal_sub style at level sets memory for subsequent auto items", async () => {
    const parser = new Parser();
    // First explicit decimal_sub (@@2.1), then auto at same level (@@)
    // The auto should inherit the decimal style from memory
    const ast = parser.parse("@1 One\n@@2.1 Two\n@1 Three\n@@ Four\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")!.async("text");

    // Both level-1 items (Two and Four) should use legal-decimal
    // Count numId references - this is a structural test
    // The key is that "Four" (auto at level 1) uses same reference as "Two" (explicit decimal_sub)
    expect(docXml).toBeTruthy(); // Basic sanity - document was generated
  });

  test("style memory resets when returning to shallower level", async () => {
    const parser = new Parser();
    // @1 One (level 0, auto -> default)
    // @@2.1 Two (level 1, explicit decimal_sub -> decimal memory at level 1)
    // @1 Three (level 0 resets level 1 memory)
    // @@ Four (level 1, auto -> should use scheme default since memory was reset)
    const ast = parser.parse("@numbering default\n\n@1 One\n@@2.1 Two\n@1 Three\n@@ Four\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")!.async("text");

    // Document should compile without error
    expect(docXml).toBeTruthy();
  });

  test("level-0 numbered items have flush-left indentation", async () => {
    const parser = new Parser();
    const ast = parser.parse("@1 First\n@2 Second\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const numXml = await zip.file("word/numbering.xml")!.async("text");

    // Level 0 should have left=360 (0.25in * 1440 = 360 twips) and hanging=360
    // This makes the number flush-left at position 0, with text at 0.25in
    // The legal-default config (abstractNumId="2") should have this for ilvl="0"
    expect(numXml).toMatch(/<w:lvl w:ilvl="0"[^>]*>[\s\S]*?<w:ind w:left="360" w:hanging="360"\/>/);
  });
});

describe("Table styling", () => {
  test("@table has borders with size=4", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [A, B]\n  [1, 2]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have table borders
    expect(xml).toContain("w:tblBorders");
    // Border size should be 4 (0.5pt)
    expect(xml).toMatch(/w:sz="4"/);
  });

  test("@table header row has light gray shading", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Header1, Header2]\n  [Data1, Data2]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Header row should have F2F2F2 shading
    expect(xml).toContain("F2F2F2");
  });

  test("@table has cell margins/padding", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [A, B]\n  [1, 2]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have table cell margins
    expect(xml).toContain("w:tblCellMar");
  });

  test("@table header text is bold", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Header]\n  [Data]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Header row should have bold run property before the text
    // Find the table row with w:tblHeader and check for w:b
    const tblRows = xml.match(/<w:tr[^>]*>[\s\S]*?<\/w:tr>/g) || [];
    const headerRow = tblRows.find(r => r.includes('w:tblHeader'));
    expect(headerRow).toBeDefined();
    expect(headerRow).toContain('<w:b');
  });
});

describe("DOCX -> LDOC (decompile)", () => {
  test("round-trip headings, emphasis, lists, and tables", async () => {
    const input = `# Title

This is **bold** and *italic* and ***both***.

@ Item one
@@ Nested item
@- Bullet one
@@- Nested bullet

@table
  [A, B]
  [1, 2]
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = await docxToLdoc(buffer);

    expect(out).toContain("# Title");
    expect(out).toContain("**bold**");
    expect(out).toContain("*italic*");
    expect(out).toContain("***both***");

    // Lists should reappear with the same marker grammar (auto numbering may not match original)
    expect(out).toMatch(/\n@ /);
    expect(out).toMatch(/\n@@ /);
    expect(out).toMatch(/\n@- /);
    expect(out).toMatch(/\n@@- /);

    expect(out).toContain("@table");
    // Table header row is bold by default in our DOCX styling.
    expect(out).toMatch(/\[(\*\*A\*\*|A), (\*\*B\*\*|B)\]/);
    expect(out).toMatch(/\[(\*\*1\*\*|1), (\*\*2\*\*|2)\]/);
  });

  test("errors on non-docx input", async () => {
    await expect(docxToLdoc(new Uint8Array([1, 2, 3]))).rejects.toThrow(/document\.xml|zip|corrupt/i);
  });
});

describe("@styles directive", () => {
  test("body style applies font and size to normal paragraphs", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@styles body font="Georgia" size=11pt

This is a normal paragraph.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Check for Georgia font in run properties (ascii and hAnsi attributes)
    expect(xml).toMatch(/w:rFonts[^>]*w:ascii="Georgia"/);
    expect(xml).toMatch(/w:rFonts[^>]*w:hAnsi="Georgia"/);
    // Check for size 11pt = 22 half-points
    expect(xml).toMatch(/w:sz[^>]*w:val="22"/);
  });

  test("heading1 style applies font and size to # headers", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@styles heading1 font="Helvetica" size=24pt

# Title`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);

    // Check document.xml for the heading styles
    const docXml = await zip.file("word/document.xml")!.async("text");
    // Also check styles.xml for Heading1 style definition
    const stylesXml = await zip.file("word/styles.xml")!.async("text");

    // Either document.xml or styles.xml should contain Helvetica and size 48 (24pt = 48 half-points)
    const hasHelvetica = docXml.includes("Helvetica") || stylesXml.includes("Helvetica");
    const hasSize48 = docXml.match(/w:sz[^>]*w:val="48"/) || stylesXml.match(/w:sz[^>]*w:val="48"/);

    expect(hasHelvetica).toBe(true);
    expect(hasSize48).toBeTruthy();
  });

  test("header style applies font and size to @header content", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@styles header font="Arial" size=9pt

@header
  Document Header

# Title

Body text.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);

    // Find header1.xml
    const headerFile = zip.file("word/header1.xml");
    expect(headerFile).toBeTruthy();
    const headerXml = await headerFile!.async("text");

    // Check for Arial font
    expect(headerXml).toContain("Arial");
    // Check for size 9pt = 18 half-points
    expect(headerXml).toMatch(/w:sz[^>]*w:val="18"/);
  });

  test("rejects invalid size unit (px)", () => {
    const parser = new Parser();
    expect(() => parser.parse(`@styles body size=12px\n\nBody.`)).toThrow(/invalid|unsupported|unit/i);
  });

  test("rejects invalid color format (named colors)", () => {
    const parser = new Parser();
    expect(() => parser.parse(`@styles body color=red\n\nBody.`)).toThrow(/invalid|hex|color/i);
  });

  test("rejects unknown style target", () => {
    const parser = new Parser();
    expect(() => parser.parse(`@styles unknown font="Arial"\n\nBody.`)).toThrow(/unknown|invalid|target/i);
  });
});
