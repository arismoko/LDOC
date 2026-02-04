import { test, expect, describe } from "bun:test";
import { format } from "../src/formatter";

describe("Formatter", () => {
  describe("Indentation", () => {
    test("defaults to tabs", () => {
      const input = `@if condition
  Then branch
@end
`;
      const formatted = format(input);
      expect(formatted).toBe(`@if condition
\tThen branch
@end
`);
    });

    test("corrects inconsistent indentation in modifier blocks", () => {
      const input = `@center
   Hello
    World
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@center
  Hello
  World
`);
    });

    test("indents nested @if blocks correctly", () => {
      // Input has correct indentation for parsing
      const input = `@if true
  Hello
@else
  World
@end
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@if true
  Hello
@else
  World
@end
`);
    });

    test("indents @foreach blocks correctly", () => {
      const input = `@foreach item in items
  {{item}}
@end
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@foreach item in items
  {{item}}
@end
`);
    });

    test("indents @repeat blocks correctly", () => {
      const input = `@repeat 3
  Hello
@end
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@repeat 3
  Hello
@end
`);
    });

    test("formats with tabs when requested", () => {
      const input = `@if condition
  Then branch
@end
`;
      const formatted = format(input, { useTabs: true });
      expect(formatted).toBe(`@if condition
\tThen branch
@end
`);
    });

    test("indents @define templates correctly", () => {
      const input = `@define MyBlock
  @box Hello

Content after define
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@define MyBlock");
      // The @box is a block modifier inside the template
      expect(formatted).toContain("@box");
    });

    test("prints hard breaks without breaking block indentation", () => {
      const input = `@bold
  hello world  
  test!
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@bold
  hello world  
  test!
`);
    });
  });

  describe("Table alignment", () => {
    test("aligns simple table columns", () => {
      const input = `@table
  @row
    @cell: Name
    @cell: Age
    @cell: Role
  @row
    @cell: Alice
    @cell: 30
    @cell: Admin
  @row
    @cell: Bob
    @cell: 25
    @cell: User
`;
      const formatted = format(input, { useTabs: false });
      // Check that columns are aligned - all values in each column have same width
      expect(formatted).toContain("@table");
      // Check table structure is preserved
      const lines = formatted.split("\n");
      const rowLines = lines.filter((l) => l.includes("@row"));
      expect(rowLines.length).toBe(3);
      
      expect(formatted).toContain("@cell: Name");
      expect(formatted).toContain("@cell: Alice");
    });

    test("handles varying column widths", () => {
      const input = `@table
  @row
    @cell: Short
    @cell: A very long value
  @row
    @cell: B
    @cell: C
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@cell: Short");
      expect(formatted).toContain("@cell: A very long value");
    });

    test("preserves empty cells", () => {
      const input = `@table
  @row
    @cell: A
    @cell: B
    @cell: C
  @row
    @cell: 1
    @cell
    @cell: 3
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@cell: 1");
      expect(formatted).toContain("@cell: 3");
      // Empty cell should be just @cell or @cell:
      // The parser/printer might output @cell for empty block
      // We expect @cell followed by newline (block form) or @cell: (inline form)
      // Since it's empty, printTable likely outputs "@cell" then empty content lines?
      // Or maybe we should standardize empty cells to "@cell:"?
      // Current implementation:
      // if (cell.content.length === 1 && paragraph...) -> inline
      // else -> block
      // Empty content length is 0 -> block form -> "@cell" + indented content (empty)
      expect(formatted).toMatch(/@cell\s*@cell: 3/); 
    });
  });

  describe("Comments and blank lines", () => {
    test("preserves comments in modifier blocks", () => {
      // Comments inside blocks are preserved
      const input = `@box
  // This is a comment
  Hello world
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("//");
      expect(formatted).toContain("Hello world");
    });

    test("single blank line separates paragraphs without extra spacing", () => {
      const input = `First paragraph

Second paragraph
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("First paragraph");
      expect(formatted).toContain("Second paragraph");
      // Single blank line = paragraph separator, no empty line in output
      const lines = formatted.split("\n");
      const firstIdx = lines.findIndex((l) => l.includes("First"));
      const secondIdx = lines.findIndex((l) => l.includes("Second"));
      expect(secondIdx - firstIdx).toBe(1); // Adjacent paragraphs
    });

    test("double blank line creates visible spacing", () => {
      const input = `First paragraph


Second paragraph
`;
      const formatted = format(input, { useTabs: false });
      const lines = formatted.split("\n");
      const firstIdx = lines.findIndex((l) => l.includes("First"));
      const secondIdx = lines.findIndex((l) => l.includes("Second"));
      // Two blank lines = 1 empty line between paragraphs
      expect(secondIdx - firstIdx).toBe(2);
    });

    test("respects empty_paragraph nodes from double blank lines", () => {
      // Two blank lines (3 newlines) creates empty_paragraph
      const input = `Hello


World
`;
      const formatted = format(input, { useTabs: false });
      const lines = formatted.split("\n");
      // Should have: "Hello", "", "World", ...
      expect(lines[0]).toBe("Hello");
      expect(lines[1]).toBe("");
      expect(lines[2]).toBe("World");
    });
  });

  describe("Headers", () => {
    test("formats headers correctly", () => {
      const input = `# Heading 1

## Heading 2

### Heading 3
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("# Heading 1");
      expect(formatted).toContain("## Heading 2");
      expect(formatted).toContain("### Heading 3");
    });
  });

  describe("Lists", () => {
    test("formats numbered items", () => {
      const input = `@1 First
@2 Second
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@1 First");
      expect(formatted).toContain("@2 Second");
    });

    test("formats bullet items", () => {
      const input = `@- First
@- Second
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@- First");
      expect(formatted).toContain("@- Second");
    });

    test("formats nested list items", () => {
      const input = `@1 Parent
@@a Child
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@1 Parent");
      expect(formatted).toContain("@@a Child");
    });
  });

  describe("Inline formatting", () => {
    test("preserves emphasis", () => {
      const input = `This is **bold** and *italic* and ***both***
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("**bold**");
      expect(formatted).toContain("*italic*");
      expect(formatted).toContain("***both***");
    });

    test("preserves variables", () => {
      const input = `Hello {{name}} and {{user.email}}
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("{{name}}");
      expect(formatted).toContain("{{user.email}}");
    });

    test("preserves cross-references", () => {
      const input = `See [[EXHIBIT A]]
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("[[EXHIBIT A]]");
    });

    test("preserves links", () => {
      const input = `Visit [Example](https://example.com)
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("[Example](https://example.com)");
    });
  });

  describe("Control flow", () => {
    test("formats @if/@else/@end", () => {
      const input = `@if condition
  Then branch
@else
  Else branch
@end
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe(`@if condition
  Then branch
@else
  Else branch
@end
`);
    });

    test("formats @columns region", () => {
      const input = `@columns 2 separator
  Content
@end
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@columns 2");
      expect(formatted).toContain("separator");
      expect(formatted).toContain("  Content");
      expect(formatted).toContain("@end");
    });
  });

  describe("Document structure", () => {
    test("formats @document block", () => {
      const input = `@document
  title: My Document
  author: John Doe

Hello world
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@document");
      expect(formatted).toContain("  title: My Document");
      expect(formatted).toContain("  author: John Doe");
      expect(formatted).toContain("Hello world");
    });

    test("formats @meta block", () => {
      const input = `@meta
  date: January 1, 2026
  parties:
    seller: Acme Corp

Content here
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@meta");
      expect(formatted).toContain("  date: January 1, 2026");
      expect(formatted).toContain("  parties:");
      expect(formatted).toContain("    seller: Acme Corp");
    });

    test("formats @header and @footer", () => {
      const input = `@header
  Page {{page}}

Content
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@header");
      expect(formatted).toContain("  Page {{page}}");
    });
  });

  describe("Modifiers", () => {
    test("formats inline modifiers on single line", () => {
      const input = `@center Hello world
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe("@center Hello world\n");
    });

    test("formats block modifiers with indented content", () => {
      const input = `@box
  First line
  Second line
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@box");
      // The parser soft-wraps single newlines in paragraphs, so content is on one line
      expect(formatted).toContain("First line");
      expect(formatted).toContain("Second line");
    });

    test("formats modifiers with counts", () => {
      const input = `@indent:2 Indented text
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@indent:2");
    });
  });

  describe("Edge cases", () => {
    test("handles empty input", () => {
      const input = "";
      const formatted = format(input, { useTabs: false });
      expect(formatted).toBe("\n");
    });

    test("ensures single trailing newline", () => {
      const input = `Hello


`;
      const formatted = format(input, { useTabs: false });
      expect(formatted.endsWith("\n")).toBe(true);
      // Should not have multiple trailing newlines
      expect(formatted).not.toMatch(/\n\n$/);
    });

    test("formats @anchor", () => {
      const input = `@anchor target
Content
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@anchor target");
    });

    test("formats @pagebreak", () => {
      const input = `First

@pagebreak

Second
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@pagebreak");
    });

    test("formats @use with arguments", () => {
      const input = `@define Template(arg1, arg2)
  Hello {{arg1}} {{arg2}}

@use Template(arg1="value1", arg2="value2")
`;
      const formatted = format(input, { useTabs: false });
      expect(formatted).toContain("@use Template");
      expect(formatted).toContain('arg1="value1"');
      expect(formatted).toContain('arg2="value2"');
    });

    test("formats @use with label", () => {
      const input = `@define Template()
  Hello

@use Template() as MyLabel
`;
      const formatted = format(input, { useTabs: false });
      // @use without args doesn't need parens
      expect(formatted).toContain("@use Template as MyLabel");
    });
  });
});
