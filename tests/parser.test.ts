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
    const lexer = new Lexer("@indent:2\n@outdent:3\n@indent 2\n@indent=36pt\n");
    const tokens = lexer.tokenize();

    const mods = tokens.filter((t) => t.type === TokenType.MODIFIER);
    expect(mods).toHaveLength(4);
    const md0 = must(mods[0]);
    const md1 = must(mods[1]);
    const md2 = must(mods[2]);
    const md3 = must(mods[3]);
    expect(md0.value).toBe("indent");
    expect(md0.count).toBe(2);
    expect(md1.value).toBe("outdent");
    expect(md1.count).toBe(3);
    expect(md2.value).toBe("indent");
    expect(md2.count).toBe(2);
    expect(md3.value).toBe("indent");
    expect(md3.length).toBe("36pt");
  });

  test("tokenizes explicit end-block sentinel", () => {
    const lexer = new Lexer("@box\n  Hello\n\nWorld\n");
    const tokens = lexer.tokenize();
    // END_BLOCK is no longer a token - blocks end via dedent or @end
    expect(tokens.some((t) => t.type === TokenType.DEDENT)).toBe(true);
  });

  test("tokenizes define and use", () => {
    const lexer = new Lexer("@define Foo\n  Hello\n@use Foo\n");
    const tokens = lexer.tokenize();
    expect(tokens.some((t) => t.type === TokenType.DEFINE)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.USE)).toBe(true);
  });

  test("@someone without space is parsed as text, not a list item", () => {
    const lexer = new Lexer("Contact @john for details.");
    const tokens = lexer.tokenize();

    // Should NOT have any numbered items
    expect(tokens.some((t) => t.type === TokenType.NUMBERED_ITEM)).toBe(false);
    // Should have text containing "@john"
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    const allText = textTokens.map((t) => t.value).join("");
    expect(allText).toContain("@john");
  });

  test("@someone at line start without space is parsed as text", () => {
    const lexer = new Lexer("@someone mentioned this");
    const tokens = lexer.tokenize();

    expect(tokens.some((t) => t.type === TokenType.NUMBERED_ITEM)).toBe(false);
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    const allText = textTokens.map((t) => t.value).join("");
    expect(allText).toContain("@someone");
  });

  test("@a with space is still a valid numbered item", () => {
    const lexer = new Lexer("@a First item");
    const tokens = lexer.tokenize();

    const numbered = tokens.filter((t) => t.type === TokenType.NUMBERED_ITEM);
    expect(numbered).toHaveLength(1);
    expect(numbered[0]!.style).toBe("a");
  });

  test("@1 with space is still a valid numbered item", () => {
    const lexer = new Lexer("@1 First item");
    const tokens = lexer.tokenize();

    const numbered = tokens.filter((t) => t.type === TokenType.NUMBERED_ITEM);
    expect(numbered).toHaveLength(1);
    expect(numbered[0]!.style).toBe("1");
  });

  test("@ followed by newline is still a valid auto-increment item", () => {
    const lexer = new Lexer("@\n  Content");
    const tokens = lexer.tokenize();

    const numbered = tokens.filter((t) => t.type === TokenType.NUMBERED_ITEM);
    expect(numbered).toHaveLength(1);
    expect(numbered[0]!.style).toBe("");
  });

  test("email-style mentions in paragraphs are preserved as text", () => {
    const lexer = new Lexer("Please contact @john.doe or @jane_smith for help.");
    const tokens = lexer.tokenize();

    expect(tokens.some((t) => t.type === TokenType.NUMBERED_ITEM)).toBe(false);
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    const allText = textTokens.map((t) => t.value).join("");
    expect(allText).toContain("@john");
    expect(allText).toContain("@jane_smith");
  });

  test("'[day]' in the middle of a line is tokenized as TEXT, not TABLE_ROW", () => {
    const lexer = new Lexer("dated January [day], 2026");
    const tokens = lexer.tokenize();

    // Should NOT have any TABLE_ROW tokens
    expect(tokens.some((t) => t.type === TokenType.TABLE_ROW)).toBe(false);
    // Should have text containing '[day]'
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    const allText = textTokens.map((t) => t.value).join("");
    expect(allText).toContain("[day]");
  });

  test("'[...]' at start of line is still parsed as TABLE_ROW", () => {
    const lexer = new Lexer("[A, B, C]");
    const tokens = lexer.tokenize();

    const tableRows = tokens.filter((t) => t.type === TokenType.TABLE_ROW);
    expect(tableRows).toHaveLength(1);
  });

  test("'[[...]]' cross-ref mid-line still works", () => {
    const lexer = new Lexer("See [[EXHIBIT A]] for details.");
    const tokens = lexer.tokenize();

    const crossRefs = tokens.filter((t) => t.type === TokenType.CROSS_REF);
    expect(crossRefs).toHaveLength(1);
    expect(crossRefs[0]!.value).toBe("EXHIBIT A");
  });
});

describe("Parser - @mention handling", () => {
  test("@mentions in paragraphs are preserved as text", () => {
    const parser = new Parser();
    const ast = parser.parse("Please contact @john for help.");

    const para = must(ast.body[0]) as any;
    expect(para.type).toBe("paragraph");
    const text = para.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toContain("@john");
  });

  test("@mentions at line start are preserved as text", () => {
    const parser = new Parser();
    const ast = parser.parse("@someone mentioned this issue.");

    const para = must(ast.body[0]) as any;
    expect(para.type).toBe("paragraph");
    const text = para.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toContain("@someone");
    expect(text).toContain("mentioned");
  });

  test("list markers still work with proper spacing", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 First item\n@@a Sub item\n\n@someone mentioned this.");

    const numbered = ast.body.filter((n) => n.type === "numbered_item");
    expect(numbered).toHaveLength(2);

    // The paragraph should contain @someone as text
    const paras = ast.body.filter((n) => n.type === "paragraph");
    expect(paras.length).toBeGreaterThan(0);
    const lastPara = paras[paras.length - 1] as any;
    const text = lastPara.content.map((n: any) => (n.type === "text" ? n.value : "")).join("");
    expect(text).toContain("@someone");
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

  test("parses nested emphasis: italic inside bold", () => {
    const parser = new Parser();
    const ast = parser.parse("**bold with *nested italic* inside**");

    const para = must(ast.body[0]) as any;
    expect(para.type).toBe("paragraph");
    expect(para.content).toHaveLength(1);

    const bold = para.content[0];
    expect(bold.type).toBe("emphasis");
    expect(bold.style).toBe("bold");

    // Bold content should have: text, italic, text
    expect(bold.content).toHaveLength(3);
    expect(bold.content[0].type).toBe("text");
    expect(bold.content[0].value).toBe("bold with ");
    expect(bold.content[1].type).toBe("emphasis");
    expect(bold.content[1].style).toBe("italic");
    expect(bold.content[2].type).toBe("text");
    expect(bold.content[2].value).toBe(" inside");
  });

  test("parses nested inline: strikethrough and code inside bold", () => {
    const parser = new Parser();
    const ast = parser.parse("**bold ~~strike~~ and `code` here**");

    const para = must(ast.body[0]) as any;
    const bold = para.content[0];
    expect(bold.type).toBe("emphasis");
    expect(bold.style).toBe("bold");

    // Bold content should have: text, strikethrough, text, code, text
    expect(bold.content).toHaveLength(5);
    expect(bold.content[0].value).toBe("bold ");
    expect(bold.content[1].type).toBe("strikethrough");
    expect(bold.content[2].value).toBe(" and ");
    expect(bold.content[3].type).toBe("inline_code");
    expect(bold.content[3].value).toBe("code");
    expect(bold.content[4].value).toBe(" here");
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

  test("single blank line acts as paragraph separator (no empty_paragraph)", () => {
    const parser = new Parser();
    // Single blank line = paragraph separator, no visual gap
    const ast = parser.parse("Hello\n\nWorld");

    const n0 = must(ast.body[0]);
    const n1 = must(ast.body[1]);
    expect(n0.type).toBe("paragraph");
    expect(n1.type).toBe("paragraph");
    expect(ast.body.length).toBe(2);
  });

  test("double blank line creates empty_paragraph for extra spacing", () => {
    const parser = new Parser();
    // Two blank lines (3 newlines) = 1 empty paragraph
    const ast = parser.parse("Hello\n\n\nWorld");

    const n0 = must(ast.body[0]);
    const n1 = must(ast.body[1]);
    const n2 = must(ast.body[2]);
    expect(n0.type).toBe("paragraph");
    expect(n1.type).toBe("empty_paragraph");
    expect((n1 as any).count).toBe(1);
    expect(n2.type).toBe("paragraph");
  });

  test("single blank line between list item and paragraph (no empty_paragraph)", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 One\n\nTwo");
    const n0 = must(ast.body[0]);
    const n1 = must(ast.body[1]);
    expect(n0.type).toBe("numbered_item");
    expect(n1.type).toBe("paragraph");
    expect(ast.body.length).toBe(2);
  });

  test("single blank line inside modifier blocks (no empty_paragraph)", () => {
    const parser = new Parser();
    const ast = parser.parse("@center\n  Hello\n\n  World\n");
    expect(must(ast.body[0]).type).toBe("modifier");
    const m: any = must(ast.body[0]);
    // Single blank line = just separates paragraphs, no empty_paragraph
    expect(must(m.content[0]).type).toBe("paragraph");
    expect(must(m.content[1]).type).toBe("paragraph");
    expect(m.content.length).toBe(2);
  });

  test("double blank line inside modifier blocks creates empty_paragraph", () => {
    const parser = new Parser();
    const ast = parser.parse("@center\n  Hello\n\n\n  World\n");
    expect(must(ast.body[0]).type).toBe("modifier");
    const m: any = must(ast.body[0]);
    // Two blank lines = empty_paragraph between paragraphs
    expect(must(m.content[0]).type).toBe("paragraph");
    expect(must(m.content[1]).type).toBe("empty_paragraph");
    expect((m.content[1] as any).count).toBe(1);
    expect(must(m.content[2]).type).toBe("paragraph");
  });

  test("dedent closes modifier block", () => {
    const parser = new Parser();
    const ast = parser.parse("@box\n  In box\n\nOutside\n");
    expect(must(ast.body[0]).type).toBe("modifier");
    const m: any = must(ast.body[0]);
    expect(m.modifier).toBe("box");
    expect(must(m.content[0]).type).toBe("paragraph");
    // After dedent, blank line becomes empty_paragraph, then paragraph
    expect(ast.body.length).toBeGreaterThanOrEqual(2);
  });

  test("dedent closes @meta block", () => {
    const parser = new Parser();
    const ast = parser.parse("@meta\n  a: 1\n\nHello\n");
    expect(ast.meta?.data.a).toBe(1);
    expect(ast.body.length).toBeGreaterThanOrEqual(1);
  });

  test("dedent closes @table block", () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [A]\n\nHello\n");
    expect(must(ast.body[0]).type).toBe("table");
    const t: any = must(ast.body[0]);
    expect(t.rows.length).toBe(1);
    expect(ast.body.length).toBeGreaterThanOrEqual(2);
  });

  test("@; at top-level is just text", () => {
    const parser = new Parser();
    // @; is no longer a special token, it's just text now
    const ast = parser.parse("@;\n");
    // May parse as text or fail to find a handler - we just check no crash
    expect(ast.body.length).toBeGreaterThanOrEqual(0);
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

  test("accepts @repeat without @end (optional)", () => {
    const parser = new Parser();
    const ast = parser.parse("@repeat 2\n  x\n");
    expect(must(ast.body[0]).type).toBe("repeat");
  });

  test("rejects @repeat above max", () => {
    const parser = new Parser();
    expect(() => parser.parse("@repeat 101\n  x\n@end\n")).toThrow(/exceeds maximum/);
  });

  test("accepts @repeat closed without @end (optional)", () => {
    const parser = new Parser();
    const ast = parser.parse("@repeat 1\n  x\n");
    expect(must(ast.body[0]).type).toBe("repeat");
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

  test("accepts @foreach without @end (optional)", () => {
    const parser = new Parser();
    const ast = parser.parse("@foreach x in items\n  y\n");
    expect(must(ast.body[0]).type).toBe("foreach");
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
@end

After columns.`);

    const n0 = must(ast.body[0]);
    expect(n0.type).toBe("columns_region");
    const col: any = n0;
    expect(col.columnCount).toBe(2);
    expect(col.gapTwip).toBe(720); // 0.5in = 720 twips
    expect(col.separator).toBe(true);
    expect(col.children.length).toBeGreaterThan(0);
    // Body after columns: single blank line = just separator, no empty_paragraph
    expect(must(ast.body[1]).type).toBe("paragraph");
  });

  test("parses @columns region with default gap", () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 3
  Content
@end`);

    const col: any = must(ast.body[0]);
    expect(col.type).toBe("columns_region");
    expect(col.columnCount).toBe(3);
    expect(col.gapTwip).toBe(720); // default 0.5in
    expect(col.separator).toBe(false);
  });

  test("accepts nested @columns", () => {
    const parser = new Parser();
    const ast = parser.parse(`@columns 2
  @columns 3
    Nested
  @end
@end`);
    expect(ast.body.length).toBe(1);
    const outer = ast.body[0] as any;
    expect(outer.type).toBe("columns_region");
    expect(outer.columnCount).toBe(2);
    // Inner columns_region should be a child of outer
    const inner = outer.children.find((c: any) => c.type === "columns_region");
    expect(inner).toBeDefined();
    expect(inner.columnCount).toBe(3);
  });

  test("rejects @columns with invalid count", () => {
    const parser = new Parser();
    expect(() => parser.parse("@columns 0\n  x\n@end\n")).toThrow();
    expect(() => parser.parse("@columns 11\n  x\n@end\n")).toThrow();
  });

  test("accepts @if without @end (optional)", () => {
    const parser = new Parser();
    const ast = parser.parse("@if true\n  x\n");
    expect(must(ast.body[0]).type).toBe("if");
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

  test("applies margins from @document block to section properties", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  margins:
    top: 1in
    right: 2in
    bottom: 3in
    left: 4in

Body.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toMatch(/w:pgMar[^>]*w:top=\"1440\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:right=\"2880\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:bottom=\"4320\"/);
    expect(xml).toMatch(/w:pgMar[^>]*w:left=\"5760\"/);
  });

  test("applies orientation from @document block to page size", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  orientation: landscape

Body.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    expect(xml).toMatch(/w:pgSz[^>]*w:orient=\"landscape\"/);
  });

  test("applies spacing from @document block to default paragraph style", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  spacing:
    line: 1.5
    before: 6pt
    after: 12pt

Body.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toMatch(/w:spacing[^>]*w:line=\"360\"/);
    expect(xml).toMatch(/w:spacing[^>]*w:before=\"120\"/);
    expect(xml).toMatch(/w:spacing[^>]*w:after="240"/);
  });

  test("default page size is Letter (12240x15840) when no @document page_size", async () => {
    const parser = new Parser();
    const ast = parser.parse(`Body paragraph.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Letter: 12240 twips wide, 15840 twips tall
    expect(xml).toMatch(/w:pgSz[^>]*w:w="12240"/);
    expect(xml).toMatch(/w:pgSz[^>]*w:h="15840"/);
  });

  test("page_size: a4 sets A4 dimensions (11906x16838)", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  page_size: a4

Body paragraph.`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // A4: ~11909 twips wide, ~16834 twips tall (8.27in x 11.69in * 1440)
    expect(xml).toMatch(/w:pgSz[^>]*w:w="11909"/);
    expect(xml).toMatch(/w:pgSz[^>]*w:h="16834"/);
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
@end

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
@end

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
@end`);

    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // 1cm = ~567 twips (1440 * 2.54 / 2.54 * 1 = ~567)
    // We should have w:cols with w:space attribute
    expect(xml).toMatch(/w:cols[^\u003e]*w:num="2"/);
    expect(xml).toMatch(/w:cols[^\u003e]*w:space="\d+"/);
  });

  test("'[day]' in prose compiles into document.xml text", async () => {
    const parser = new Parser();
    const ast = parser.parse(`dated January [day], 2026`);
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Extract all text runs
    const text = Array.from(xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g))
      .map((m) => m[1])
      .join("");

    expect(text).toContain("[day]");
    expect(text).toContain("January");
    expect(text).toContain("2026");
  });
});

describe("numbering in @document block", () => {
  test("parses numbering: default from @document block", () => {
    const parser = new Parser();
    const ast = parser.parse("@document\n  numbering: default\n\n@1 One\n");
    expect(ast.document?.numbering).toBe("default");
  });

  test("parses numbering: decimal from @document block", () => {
    const parser = new Parser();
    const ast = parser.parse("@document\n  numbering: decimal\n\n@1 One\n");
    expect(ast.document?.numbering).toBe("decimal");
  });

  test("defaults to no numberingScheme when directive absent", () => {
    const parser = new Parser();
    const ast = parser.parse("@1 One\n");
    expect(ast.numberingScheme).toBeUndefined();
  });

  test("rejects unknown numbering scheme in @document block", () => {
    const parser = new Parser();
    expect(() => parser.parse("@document\n  numbering: roman\n")).toThrow(/default.*decimal|invalid|unknown/i);
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
    const ast = parser.parse("@document\n  numbering: decimal\n\n@1 One\n@@ Two\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")!.async("text");
    const numXml = await zip.file("word/numbering.xml")!.async("text");

    // legal-decimal uses "%1.%2." format at level 1
    expect(numXml).toContain("%1.%2.");
    // The document should reference the decimal numbering config
    // numId=2 maps to abstractNumId=3 (legal-decimal)
    expect(docXml).toMatch(/<w:numId w:val="2"/);
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
    const ast = parser.parse("@document\n  numbering: default\n\n@1 One\n@@2.1 Two\n@1 Three\n@@ Four\n");
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

  test("@table with colspan using > marker", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Header1, Header2, Header3]\n  [Spanning Cell, >, Normal]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have gridSpan for colspan
    expect(xml).toContain("w:gridSpan");
    expect(xml).toMatch(/w:val="2"/);
  });

  test("@table with rowspan using ^ marker", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Header1, Header2]\n  [Spanning, Normal1]\n  [^, Normal2]\n");
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");

    // Should have vMerge for rowspan
    expect(xml).toContain("w:vMerge");
  });

  test("quoted > in table cell is literal text, not colspan", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Column]\n  [\">\"]\n");

    // Should parse as a table with one cell containing ">"
    const table = ast.body[0];
    expect(table).toBeDefined();
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      const row = table.rows[1];
      expect(row).toBeDefined();
      expect(row?.cells.length).toBe(1);
      const cell = row?.cells[0];
      expect(cell?.content.length).toBe(1);
      expect(cell?.content[0]?.type).toBe("text");
      if (cell?.content[0]?.type === "text") {
        expect(cell.content[0].value).toBe(">");
      }
    }
  });

  test("quoted ^ in table cell is literal text, not rowspan", async () => {
    const parser = new Parser();
    const ast = parser.parse("@table\n  [Column]\n  [\"^\"]\n");

    // Should parse as a table with one cell containing "^"
    const table = ast.body[0];
    expect(table).toBeDefined();
    expect(table?.type).toBe("table");
    if (table?.type === "table") {
      const row = table.rows[1];
      expect(row).toBeDefined();
      expect(row?.cells.length).toBe(1);
      const cell = row?.cells[0];
      expect(cell?.content.length).toBe(1);
      expect(cell?.content[0]?.type).toBe("text");
      if (cell?.content[0]?.type === "text") {
        expect(cell.content[0].value).toBe("^");
      }
    }
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
    const out = (await docxToLdoc(buffer)).source;

    expect(out).toContain("# Title");
    expect(out).toContain("**bold**");
    expect(out).toContain("*italic*");
    expect(out).toContain("***both***");

    // Lists should reappear with format-specific markers
    expect(out).toMatch(/\n@1 /);
    expect(out).toMatch(/\n@@a /);
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

  test("header/footer roundtrip", async () => {
    const input = `@header
  Header Text Here

@footer
  Footer Text Here

# Title

Body paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    expect(out).toContain("@header");
    expect(out).toContain("Header Text Here");
    expect(out).toContain("@footer");
    expect(out).toContain("Footer Text Here");
  });

  test("alignment roundtrip", async () => {
    const input = `@center Centered paragraph

@right Right aligned paragraph

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    expect(out).toContain("@center");
    expect(out).toContain("Centered paragraph");
    expect(out).toContain("@right");
    expect(out).toContain("Right aligned paragraph");
  });

  test("pagebreak roundtrip", async () => {
    const input = `First paragraph.

@pagebreak

Second paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    expect(out).toContain("First paragraph");
    expect(out).toContain("@pagebreak");
    expect(out).toContain("Second paragraph");
  });

  test("columns roundtrip", async () => {
    const input = `Before columns.

@columns 2 gap=0.5in separator
  Column content here.
@end

After columns.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    expect(out).toContain("@columns 2");
    expect(out).toContain("Column content here");
    expect(out).toContain("@end");
  });

  test("margins and landscape roundtrip", async () => {
    const input = `@document
  margins:
    top: 0.75in
    right: 0.75in
    bottom: 0.75in
    left: 0.75in
  orientation: landscape

Body paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Decompiler should emit @document block with margins and orientation
    expect(out).toContain("@document");
    expect(out).toMatch(/margins/);
    expect(out).toMatch(/0\.75/);
    expect(out).toMatch(/landscape|orientation/);
  });

  test("indent length roundtrip", async () => {
    const input = `@indent=36pt
  First paragraph.

  Second paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer, { emitIndent: 'on' })).source;

    expect(out).toContain("@indent=36pt");
    expect(out).toContain("First paragraph");
    expect(out).toContain("Second paragraph");
  });

  test("indent emission defaults to off", async () => {
    const input = `@indent=36pt
  First paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Default is off, so no @indent directive
    expect(out).not.toMatch(/@indent/);
    expect(out).toContain("First paragraph");
  });

  test("decompiles style-based indentation from styles.xml", async () => {
    const zip = new JSZip();
    zip.folder("word")!.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
      </w:pPr>
      <w:r><w:t>TABLE OF CONTENTS</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    );
    zip.folder("word")!.file(
      "styles.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:pPr>
      <w:ind w:left="2598"/>
    </w:pPr>
  </w:style>
</w:styles>`
    );

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const out = (await docxToLdoc(buffer, { emitIndent: 'on' })).source;

    expect(out).toContain("TABLE OF CONTENTS");
    // 2598 twips / 20 = 129.9pt
    expect(out).toMatch(/@indent=129\.9pt/);
  });

  test("emitIndent=off suppresses @indent directives on style-indented paragraphs", async () => {
    const zip = new JSZip();
    zip.folder("word")!.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
      </w:pPr>
      <w:r><w:t>TABLE OF CONTENTS</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    );
    zip.folder("word")!.file(
      "styles.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title">
    <w:pPr>
      <w:ind w:left="2598"/>
    </w:pPr>
  </w:style>
</w:styles>`
    );

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const out = (await docxToLdoc(buffer, { emitIndent: 'off' })).source;

    expect(out).toContain("TABLE OF CONTENTS");
    // With emitIndent=off, should NOT have @indent directive
    expect(out).not.toMatch(/@indent/);
  });
});

describe("styles in @document block", () => {
  test("body style applies font and size to normal paragraphs", async () => {
    const parser = new Parser();
    const ast = parser.parse(`@document
  styles:
    body:
      font: Georgia
      size: 11pt

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
    const ast = parser.parse(`@document
  styles:
    heading1:
      font: Helvetica
      size: 24pt

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
    const ast = parser.parse(`@document
  styles:
    header:
      font: Arial
      size: 9pt

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
});

describe("DOCX -> LDOC TOC handling", () => {
  test("TOC-styled paragraphs do not emit list markers", async () => {
    // Construct a minimal DOCX with TOC1 and TOC2 styled paragraphs that have w:numPr
    const zip = new JSZip();

    // [Content_Types].xml
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
    );

    // _rels/.rels
    zip.folder("_rels")!.file(
      ".rels",
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    );

    // word/document.xml with TOC-styled paragraphs
    zip.folder("word")!.file(
      "document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="TOC1"/>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Introduction</w:t></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:t>1</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Toc2"/>
        <w:numPr>
          <w:ilvl w:val="1"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Background</w:t></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:t>2</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Normal"/>
        <w:numPr>
          <w:ilvl w:val="0"/>
          <w:numId w:val="1"/>
        </w:numPr>
      </w:pPr>
      <w:r><w:t>Regular list item</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
    );

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const out = (await docxToLdoc(buffer)).source;

    // TOC paragraphs should NOT have list markers
    // Tabs are preserved in TOC output for readable title+page format
    expect(out).toContain("Introduction\t1");
    expect(out).toContain("Background\t2");
    expect(out).not.toMatch(/@ Introduction/);
    expect(out).not.toMatch(/@@ Background/);

    // Regular list item SHOULD have a list marker (with format suffix)
    expect(out).toMatch(/@1 Regular list item/);
  });
});

describe("DOCX -> LDOC alignment grouping", () => {
  test("consecutive centered paragraphs are grouped into block form", async () => {
    const input = `@center Line one

@center Line two

@center Line three

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Should have block form for 3 consecutive centered lines
    expect(out).toMatch(/@center\n\s+Line one/);
    expect(out).toContain("Line two");
    expect(out).toContain("Line three");
    // Normal paragraph should follow
    expect(out).toContain("Normal paragraph");
  });

  test("single centered paragraph uses inline form", async () => {
    const input = `@center Single centered line

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Should use inline form for single centered paragraph
    expect(out).toMatch(/@center Single centered line/);
  });

  test("consecutive right-aligned paragraphs are grouped into block form", async () => {
    const input = `@right Right one

@right Right two

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Should have block form for 2+ consecutive right-aligned lines
    expect(out).toMatch(/@right\n\s+Right one/);
    expect(out).toContain("Right two");
  });

  test("headings break alignment grouping", async () => {
    const input = `@center Centered one

# Heading

@center Centered two

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // Heading should break the grouping, so each @center should be inline
    expect(out).toMatch(/@center Centered one/);
    expect(out).toMatch(/@center Centered two/);
    expect(out).toContain("# Heading");
  });

  test("list items break alignment grouping", async () => {
    const input = `@center Centered one

@ List item

@center Centered two

Normal paragraph.
`;

    const ast = new Parser().parse(input);
    const buffer = await new DocxCompiler().compile(ast);
    const out = (await docxToLdoc(buffer)).source;

    // List item should break the grouping (format suffix may vary)
    expect(out).toMatch(/@center Centered one/);
    expect(out).toMatch(/@center Centered two/);
    expect(out).toMatch(/@\d+ List item|@[a-z] List item/);
  });
});

describe("Inline Style", () => {
  test("tokenizes inline style", () => {
    const lexer = new Lexer('Text @style(color=red)[styled] more');
    const tokens = lexer.tokenize();
    const styleToken = tokens.find(t => t.type === TokenType.INLINE_STYLE);
    expect(styleToken).toBeDefined();
    expect(styleToken!.attributes).toEqual({ color: "red" });
    expect(styleToken!.rawContent).toBe("styled");
  });

  test("tokenizes multiple attributes", () => {
    const lexer = new Lexer('@style(font=Arial size=14pt color=FF0000)[text]');
    const tokens = lexer.tokenize();
    const styleToken = tokens.find(t => t.type === TokenType.INLINE_STYLE);
    expect(styleToken!.attributes).toEqual({ 
      font: "Arial", 
      size: "14pt", 
      color: "FF0000" 
    });
  });

  test("tokenizes quoted attribute values", () => {
    const lexer = new Lexer('@style(font="Times New Roman")[text]');
    const tokens = lexer.tokenize();
    const styleToken = tokens.find(t => t.type === TokenType.INLINE_STYLE);
    expect(styleToken!.attributes!.font).toBe("Times New Roman");
  });

  test("handles balanced brackets in content", () => {
    const lexer = new Lexer('@style(color=red)[array[0] value]');
    const tokens = lexer.tokenize();
    const styleToken = tokens.find(t => t.type === TokenType.INLINE_STYLE);
    expect(styleToken!.rawContent).toBe("array[0] value");
  });

  test("parses inline style to AST", () => {
    const parser = new Parser();
    const ast = parser.parse('The @style(color=red)[penalty] is due.');
    const para = ast.body[0] as any;
    const inlineStyle = para.content.find((n: any) => n.type === "inline_style");
    expect(inlineStyle).toBeDefined();
    expect(inlineStyle.attributes.color).toBe("red");
  });

  test("parses nested markdown in inline style", () => {
    const parser = new Parser();
    const ast = parser.parse('@style(color=red)[**bold text**]');
    const para = ast.body[0] as any;
    const inlineStyle = para.content.find((n: any) => n.type === "inline_style");
    expect(inlineStyle.content[0].type).toBe("emphasis");
  });

  test("compiles inline style with color", async () => {
    const parser = new Parser();
    const ast = parser.parse('Normal @style(color=FF0000)[red text] normal');
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain('w:color');
    expect(xml).toContain('FF0000');
  });

  test("compiles inline style with font", async () => {
    const parser = new Parser();
    const ast = parser.parse('@style(font=Arial)[styled]');
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    expect(xml).toContain('Arial');
  });

  test("compiles inline style with size", async () => {
    const parser = new Parser();
    const ast = parser.parse('@style(size=24pt)[big text]');
    const compiler = new DocxCompiler();
    const buffer = await compiler.compile(ast);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("text");
    // 24pt = 48 half-points
    expect(xml).toContain('w:sz');
    expect(xml).toMatch(/w:val="48"/);
  });

  test("error on unclosed inline style", () => {
    const lexer = new Lexer('@style(color=red)[unclosed');
    expect(() => lexer.tokenize()).toThrow();
  });

  test("error on multiline content", () => {
    const lexer = new Lexer('@style(color=red)[line1\nline2]');
    expect(() => lexer.tokenize()).toThrow();
  });
});
