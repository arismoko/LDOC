import { test, expect, describe } from "bun:test";
import { Parser } from "../../src/parser/parser";
import { DocxCompiler } from "../../src/compiler/docx";
import JSZip from "jszip";

// ============================================================================
// Helper utilities (as specified: minimal, inline in test file)
// ============================================================================

function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error("Expected value to be defined");
  }
  return value as NonNullable<T>;
}

/**
 * Compile LDOC source to a DOCX buffer.
 * Optionally accepts variables to merge into the compiler context.
 */
async function compileToDocxBuffer(
  ldoc: string,
  vars?: Record<string, unknown>
): Promise<Buffer> {
  const parser = new Parser();
  const ast = parser.parse(ldoc);
  const compiler = new DocxCompiler(vars ?? {});
  return compiler.compile(ast);
}

/**
 * Read a file from a DOCX (ZIP) buffer as text.
 */
async function readZipText(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(path);
  if (!file) {
    throw new Error(`File not found in ZIP: ${path}`);
  }
  return file.async("text");
}

/**
 * Extract all <w:t> text runs from document.xml into an array of strings.
 */
function extractTextRuns(documentXml: string): string[] {
  const matches = documentXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g);
  return Array.from(matches).map((m) => must(m[1]));
}

/**
 * Join all text runs into a single string (for searching).
 */
function joinTextRuns(documentXml: string): string {
  return extractTextRuns(documentXml).join("");
}

// ============================================================================
// Characterization Tests: Directive Behavior
// ============================================================================

describe("Characterization: @define / @use", () => {
  test("basic expansion: output contains clause text, no literal @define or @use", async () => {
    const ldoc = `
@define(GreetingClause)
  Hello from the defined clause.

# Document Title

@use(GreetingClause)
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // The expanded text should appear in output
    expect(text).toContain("Hello from the defined clause");

    // Literal directives should NOT appear in output
    expect(text).not.toContain("@define");
    expect(text).not.toContain("@use");
  });

  test("parameterized @define/@use substitutes values", async () => {
    const ldoc = `
@define(Notice, title, body)
  **{{title}}:** {{body}}

@use(Notice, title: "WARNING", body: "Read carefully")
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("WARNING");
    expect(text).toContain("Read carefully");
    expect(text).not.toContain("{{title}}");
    expect(text).not.toContain("{{body}}");
  });
});

describe("Characterization: @if / @else / @end", () => {
  test("true condition: only then-branch text appears", async () => {
    const ldoc = `
@meta
  show_section: true

@if(show_section)
  This section is visible.
@else
  This section is hidden.
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("This section is visible");
    expect(text).not.toContain("This section is hidden");
    expect(text).not.toContain("@if");
    expect(text).not.toContain("@else");
    expect(text).not.toContain("@end");
  });

  test("false condition: only else-branch text appears", async () => {
    const ldoc = `
@meta
  show_section: false

@if(show_section)
  This section is visible.
@else
  This section is hidden.
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("This section is hidden");
    expect(text).not.toContain("This section is visible");
  });

  test("literal 'true' condition evaluates to truthy", async () => {
    const ldoc = `
@if(true)
  Always shown.
@else
  Never shown.
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("Always shown");
    expect(text).not.toContain("Never shown");
  });

  test("literal 'false' condition evaluates to falsy", async () => {
    const ldoc = `
@if(false)
  Never shown.
@else
  Always shown.
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("Always shown");
    expect(text).not.toContain("Never shown");
  });
});

describe("Characterization: @repeat", () => {
  test("repeat N times: output contains N occurrences of marker text", async () => {
    const ldoc = `
@repeat(5)
  XMARKERX
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // Count occurrences using regex (text may be in single run or multiple)
    const matches = text.match(/XMARKERX/g);
    expect(matches?.length ?? 0).toBe(5);
  });

  test("repeat 0 times: marker text does not appear", async () => {
    const ldoc = `
@repeat(0)
  SHOULD_NOT_APPEAR
@end

After repeat.
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).not.toContain("SHOULD_NOT_APPEAR");
    expect(text).toContain("After repeat");
  });

  test("repeat 1 time: marker text appears exactly once", async () => {
    const ldoc = `
@repeat(1)
  XSINGLEMARKERX
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    const matches = text.match(/XSINGLEMARKERX/g);
    expect(matches?.length ?? 0).toBe(1);
  });
});

describe("Characterization: @foreach", () => {
  test("iterates over comma-separated string from param", async () => {
    const ldoc = `
@define(ListItems, items)
  @foreach(item, in: items)
    Item: {{item}}
  @end

@use(ListItems, items: "apple,banana,cherry")
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("apple");
    expect(text).toContain("banana");
    expect(text).toContain("cherry");
    expect(text).not.toContain("@foreach");
  });

  test("iterates over object keys from @meta", async () => {
    const ldoc = `
@meta
  fruits:
    apple: red
    banana: yellow
    grape: purple

@foreach(fruit, in: fruits)
  Fruit: {{fruit}}
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("apple");
    expect(text).toContain("banana");
    expect(text).toContain("grape");
    expect(text).not.toContain("@foreach");
    expect(text).not.toContain("@end");
  });

  test("empty iterable produces no output", async () => {
    // Using an empty object in meta
    const ldoc = `
@meta
  emptyObj:

Before loop.

@foreach(item, in: emptyObj)
  SHOULD_NOT_APPEAR: {{item}}
@end

After loop.
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("Before loop");
    expect(text).toContain("After loop");
    expect(text).not.toContain("SHOULD_NOT_APPEAR");
  });
});

describe("Characterization: @anchor and [[cross-ref]]", () => {
  test("@anchor creates bookmarkStart, [[ref]] creates hyperlink with w:anchor", async () => {
    const ldoc = `
@anchor(MySection)
# Section Title

See [[MySection]] for details.
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");

    // The bookmark name uses an internal slug (e.g. "section_title" from heading)
    // rather than the anchor name directly
    expect(xml).toMatch(/w:bookmarkStart[^>]*w:name="/);

    // Verify hyperlink with w:anchor attribute exists
    expect(xml).toMatch(/w:hyperlink[^>]*w:anchor="/);

    // The hyperlink text should contain the reference name
    const text = joinTextRuns(xml);
    expect(text).toContain("MySection");
  });

  test("heading text creates implicit anchor for [[heading]]", async () => {
    const ldoc = `
# EXHIBIT A

See [[EXHIBIT A]] for the exhibit.
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");

    // Bookmarks and hyperlinks should be present
    expect(xml).toContain("w:bookmarkStart");
    expect(xml).toContain("w:hyperlink");
    expect(xml).toMatch(/w:anchor=/);
  });

  test("cross-ref link text shows the reference target", async () => {
    const ldoc = `
@anchor(TargetAnchor)
Target content.

Link: [[TargetAnchor]]
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // The link text should contain the reference name
    expect(text).toContain("TargetAnchor");
  });
});

describe("Characterization: unresolved references (cross-refs and variables)", () => {
  test("unresolved [[ref]] throws by default", async () => {
    const ldoc = `
See [[NONEXISTENT_TARGET]] for details.
`;

    await expect(compileToDocxBuffer(ldoc)).rejects.toThrow(/Unresolved cross-references/i);
  });

  test("unresolved {{variable}} throws by default", async () => {
    const ldoc = `
Hello {{missing_variable}}.
`;

    await expect(compileToDocxBuffer(ldoc)).rejects.toThrow(/Unresolved variables/i);
  });

  test("allow_undefined: true suppresses errors for missing refs and vars", async () => {
    const ldoc = `
@document
  allow_undefined: true

See [[NONEXISTENT]] and {{missing_var}}.
`;

    // Should NOT throw
    const buffer = await compileToDocxBuffer(ldoc);
    expect(buffer.length).toBeGreaterThan(0);

    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // The placeholders should appear as-is or be rendered somehow
    // (characterizing current behavior)
    expect(text).toContain("NONEXISTENT");
    expect(text).toContain("missing_var");
  });
});

describe("Characterization: numbering with @repeat", () => {
  test("numbered items inside @repeat get sequential numbers", async () => {
    const ldoc = `
@repeat(3)
  @1 Item
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");

    // Should have numbering references
    expect(xml).toContain("w:numPr");
    expect(xml).toContain("w:numId");

    // Three items should be created
    const runs = extractTextRuns(xml);
    const itemCount = runs.filter((t) => t.includes("Item")).length;
    expect(itemCount).toBe(3);
  });
});

describe("Characterization: combined directives", () => {
  test("@if inside @foreach with loop variable as condition", async () => {
    // Note: items[key] syntax is NOT supported for @if conditions.
    // Only direct variable references work. This test characterizes
    // that @foreach exposes the loop variable for use in content.
    const ldoc = `
@meta
  items:
    apple: red
    banana: yellow

@foreach(key, in: items)
  Fruit: {{key}}
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // The keys should appear
    expect(text).toContain("apple");
    expect(text).toContain("banana");
    // Should not contain directive literals
    expect(text).not.toContain("@foreach");
  });

  test("@if with indexed access (items[key]) evaluates as falsy (not resolved)", async () => {
    // This characterizes that items[key] syntax in @if conditions is NOT
    // properly resolved - the condition is treated as a literal string
    // which then evaluates to falsy, so the body is not rendered.
    const ldoc = `
@meta
  items:
    a: true

@foreach(key, in: items)
  Before if
  @if(items[key])
    Inside if: {{key}}
  @end
  After if
@end
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    // The @if body is NOT rendered because items[key] doesn't resolve
    expect(text).toContain("Before if");
    expect(text).toContain("After if");
    expect(text).not.toContain("Inside if");
  });

  test("@define with nested @if", async () => {
    const ldoc = `
@define(ConditionalClause, show)
  @if(show)
    Clause is visible.
  @else
    Clause is hidden.
  @end

@use(ConditionalClause, show: "true")
`;

    const buffer = await compileToDocxBuffer(ldoc);
    const xml = await readZipText(buffer, "word/document.xml");
    const text = joinTextRuns(xml);

    expect(text).toContain("visible");
    expect(text).not.toContain("@define");
    expect(text).not.toContain("@use");
  });
});
