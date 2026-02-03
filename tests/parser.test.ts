import { test, expect, describe } from "bun:test";
import { Lexer, TokenType } from "../src/parser/lexer";
import { Parser } from "../src/parser/parser";
import { DocxCompiler } from "../src/compiler/docx";
import JSZip from "jszip";

describe("Lexer", () => {
  test("tokenizes numbered items with levels", () => {
    const lexer = new Lexer("@1 First\n@@a Second\n@@@i Third");
    const tokens = lexer.tokenize();

    const numbered = tokens.filter((t) => t.type === TokenType.NUMBERED_ITEM);
    expect(numbered).toHaveLength(3);
    expect(numbered[0].level).toBe(1);
    expect(numbered[0].style).toBe("1");
    expect(numbered[1].level).toBe(2);
    expect(numbered[1].style).toBe("a");
    expect(numbered[2].level).toBe(3);
    expect(numbered[2].style).toBe("i");
  });

  test("tokenizes modifiers", () => {
    const lexer = new Lexer("@center @bold Hello");
    const tokens = lexer.tokenize();

    const modifiers = tokens.filter((t) => t.type === TokenType.MODIFIER);
    expect(modifiers).toHaveLength(2);
    expect(modifiers[0].value).toBe("center");
    expect(modifiers[1].value).toBe("bold");
  });

  test("tokenizes variables", () => {
    const lexer = new Lexer("Hello {{name}} and {{property.address}}");
    const tokens = lexer.tokenize();

    const vars = tokens.filter((t) => t.type === TokenType.VARIABLE);
    expect(vars).toHaveLength(2);
    expect(vars[0].value).toBe("name");
    expect(vars[1].value).toBe("property.address");
  });

  test("tokenizes headers", () => {
    const lexer = new Lexer("# Heading 1\n## Heading 2\n### Heading 3");
    const tokens = lexer.tokenize();

    const headers = tokens.filter((t) => t.type === TokenType.HEADER);
    expect(headers).toHaveLength(3);
    expect(headers[0].level).toBe(1);
    expect(headers[1].level).toBe(2);
    expect(headers[2].level).toBe(3);
  });

  test("tokenizes bullets", () => {
    const lexer = new Lexer("@- Item 1\n@@- Item 2");
    const tokens = lexer.tokenize();

    const bullets = tokens.filter((t) => t.type === TokenType.BULLET);
    expect(bullets).toHaveLength(2);
    expect(bullets[0].level).toBe(1);
    expect(bullets[1].level).toBe(2);
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
    expect(mods[0].value).toBe("indent");
    expect(mods[0].count).toBe(2);
    expect(mods[1].value).toBe("outdent");
    expect(mods[1].count).toBe(3);
    expect(mods[2].value).toBe("indent");
    expect(mods[2].count).toBe(2);
  });

  test("tokenizes explicit end-block sentinel", () => {
    const lexer = new Lexer("@box\n  Hello\n  @;\nWorld\n");
    const tokens = lexer.tokenize();
    expect(tokens.some((t) => t.type === TokenType.END_BLOCK)).toBe(true);
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
    expect(ast.body[0].type).toBe("anchor");
    expect((ast.body[0] as any).name).toBe("Foo");
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

    expect(ast.body[0].type).toBe("modifier");
    const modifier = ast.body[0] as any;
    expect(modifier.modifier).toBe("center");
  });

  test("parses variables in content", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello {{name}}");

    const para = ast.body[0] as any;
    expect(para.type).toBe("paragraph");
    expect(para.content.some((n: any) => n.type === "variable")).toBe(true);
  });

  test("soft-wraps single newlines within paragraphs", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello\nWorld");
    expect(ast.body).toHaveLength(1);
    expect(ast.body[0].type).toBe("paragraph");
    const p: any = ast.body[0];
    const text = p.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toBe("Hello World");
  });

  test("soft-wraps single newlines within list item content", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 Hello\nWorld\n\n@2 Next");
    expect(ast.body[0].type).toBe("numbered_item");
    const item: any = ast.body[0];
    const text = item.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toBe("Hello World");
  });

  test("@1 with empty line uses first indented paragraph as content", () => {
    const parser = new Parser();
    const ast = parser.parse("@1\n  Hello\n  World\n@2 Next");
    const item: any = ast.body[0];
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
  });

  test("preserves blank lines as spacing", () => {
    const parser = new Parser();
    const ast = parser.parse("Hello\n\nWorld");

    expect(ast.body[0].type).toBe("paragraph");
    expect(ast.body[1].type).toBe("empty_paragraph");
    expect((ast.body[1] as any).count).toBe(1);
    expect(ast.body[2].type).toBe("paragraph");
  });

  test("preserves blank lines between list item and following paragraph", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 One\n\nTwo");
    expect(ast.body[0].type).toBe("numbered_item");
    expect(ast.body[1].type).toBe("empty_paragraph");
    expect((ast.body[1] as any).count).toBe(1);
    expect(ast.body[2].type).toBe("paragraph");
  });

  test("preserves blank lines inside modifier blocks", () => {
    const parser = new Parser();
    const ast = parser.parse("@center\n  Hello\n\n  World\n");
    expect(ast.body[0].type).toBe("modifier");
    const m: any = ast.body[0];
    // content should include: paragraph, empty_paragraph, paragraph
    expect(m.content[0].type).toBe("paragraph");
    expect(m.content[1].type).toBe("empty_paragraph");
    expect(m.content[2].type).toBe("paragraph");
  });

  test("@; closes modifier block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@box\n  In box\n@;\nOutside\n");
    expect(ast.body[0].type).toBe("modifier");
    const m: any = ast.body[0];
    expect(m.modifier).toBe("box");
    expect(m.content[0].type).toBe("paragraph");
    expect(ast.body[1].type).toBe("paragraph");
  });

  test("@; closes @meta block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@meta\n  a: 1\n@;\nHello\n");
    expect(ast.meta?.data.a).toBe("1");
    expect(ast.body[0].type).toBe("paragraph");
  });

  test("@; closes @table block early", () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [A]\n@;\nHello\n");
    expect(ast.body[0].type).toBe("table");
    const t: any = ast.body[0];
    expect(t.rows.length).toBe(1);
    expect(ast.body[1].type).toBe("paragraph");
  });

  test("@; at top-level is an error", () => {
    const parser = new Parser();
    expect(() => parser.parse("@;\n")).toThrow(/Unmatched @;/);
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
});
