/**
 * Parser tests
 */

import { describe, test, expect } from "bun:test";
import { parseSource } from "../src/parse/index.ts";
import type { CSTDirective, CSTHeader, CSTParagraph, CSTList, CSTLink, CSTImage, CSTDefinedTerm, CSTBlank, CSTFootnoteDef } from "../src/types/cst.ts";

describe("Parser", () => {
  describe("documents", () => {
    test("parses empty document", () => {
      const result = parseSource("");
      expect(result.cst.type).toBe("Document");
      expect(result.cst.children.length).toBe(0);
    });

    test("parses single paragraph", () => {
      const result = parseSource("Hello world");
      expect(result.cst.children.length).toBe(1);
      expect(result.cst.children[0]!.type).toBe("Paragraph");
    });
  });

  describe("directives", () => {
    test("parses simple directive", () => {
      const result = parseSource("@document");
      expect(result.cst.children.length).toBe(1);
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("document");
    });

    test("parses directive with arguments", () => {
      const result = parseSource('@document(title: "My Doc")');
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.arguments.length).toBe(1);
      expect(directive.arguments[0]!.type).toBe("NamedArg");
    });

    test("parses directive with body", () => {
      const result = parseSource("@define(myMacro)\n  Hello");
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("define");
      expect(directive.body).not.toBeNull();
      expect(directive.body!.length).toBeGreaterThan(0);
    });

    test("parses @document with opaque YAML-like body", () => {
      const result = parseSource(`@document
  margins:
    top: 0.9in
    right: 1in
  styles:
    body:
      font: Arial

Some content.
`);
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("document");
      // Body should be null (opaque body instead)
      expect(directive.body).toBeNull();
      // Opaque body should contain the YAML-like content
      expect(directive.opaqueBody).toBeDefined();
      expect(directive.opaqueBody).toContain("margins:");
      expect(directive.opaqueBody).toContain("top: 0.9in");
      expect(directive.opaqueBody).toContain("styles:");
      expect(directive.opaqueBody).toContain("font: Arial");
      // The content after @document should not be in the opaque body
      expect(directive.opaqueBody).not.toContain("Some content");
      
      // The content after should be a separate paragraph
      expect(result.cst.children.length).toBe(2);
      const para = result.cst.children[1];
      expect(para?.type).toBe("Paragraph");
    });
  });

  describe("headers", () => {
    test("parses h1", () => {
      const result = parseSource("# Heading 1");
      expect(result.cst.children.length).toBe(1);
      const header = result.cst.children[0] as CSTHeader;
      expect(header.type).toBe("Header");
      expect(header.level).toBe(1);
    });

    test("parses h3", () => {
      const result = parseSource("### Heading 3");
      const header = result.cst.children[0] as CSTHeader;
      expect(header.type).toBe("Header");
      expect(header.level).toBe(3);
    });
  });

  describe("lists", () => {
    test("parses bullet list", () => {
      const result = parseSource("- Item 1\n- Item 2");
      expect(result.cst.children.length).toBe(1);
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.ordered).toBe(false);
      expect(list.items.length).toBe(2);
    });

    test("parses nested list", () => {
      const result = parseSource("- Parent\n  - Child");
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.items.length).toBe(1);
      expect(list.items[0]!.children.length).toBeGreaterThan(0);
    });
  });

  describe("inline content", () => {
    test("parses bold text", () => {
      const result = parseSource("**bold**");
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.content.length).toBeGreaterThan(0);
      expect(para.content[0]!.type).toBe("Emphasis");
    });

    test("parses variables", () => {
      const result = parseSource("Hello {{ name }}");
      const para = result.cst.children[0] as CSTParagraph;
      const variable = para.content.find(c => c.type === "Variable");
      expect(variable).toBeDefined();
    });

    test("parses footnote references", () => {
      const result = parseSource("Text[^note]");
      const para = result.cst.children[0] as CSTParagraph;
      const footnote = para.content.find(c => c.type === "FootnoteRef");
      expect(footnote).toBeDefined();
    });

    test("parses cross references", () => {
      const result = parseSource("See [[section]]");
      const para = result.cst.children[0] as CSTParagraph;
      const crossRef = para.content.find(c => c.type === "CrossRef");
      expect(crossRef).toBeDefined();
    });
  });

  describe("special blocks", () => {
    test("parses horizontal rule", () => {
      const result = parseSource("---");
      expect(result.cst.children[0]!.type).toBe("HorizontalRule");
    });

    test("parses blockquote", () => {
      const result = parseSource("> Quote text");
      expect(result.cst.children[0]!.type).toBe("Blockquote");
    });
  });

  describe("links and images", () => {
    test("parses markdown links", () => {
      const result = parseSource("[Click here](https://example.com)");
      const para = result.cst.children[0] as CSTParagraph;
      const link = para.content[0] as CSTLink;
      expect(link.type).toBe("Link");
      expect(link.url).toBe("https://example.com");
    });

    test("parses images", () => {
      const result = parseSource("![Alt text](image.png)");
      const para = result.cst.children[0] as CSTParagraph;
      const image = para.content[0] as CSTImage;
      expect(image.type).toBe("Image");
      expect(image.alt).toBe("Alt text");
      expect(image.src).toBe("image.png");
    });

    test("parses links with surrounding text", () => {
      const result = parseSource("See [the docs](https://docs.example.com) for more.");
      const para = result.cst.children[0] as CSTParagraph;
      const link = para.content.find(c => c.type === "Link") as CSTLink;
      expect(link).toBeDefined();
      expect(link.url).toBe("https://docs.example.com");
    });
  });

  describe("tables (via directives)", () => {
    test("parses @table directive", () => {
      const result = parseSource("@table\n  @row\n    @cell Content");
      const table = result.cst.children[0] as CSTDirective;
      expect(table.type).toBe("Directive");
      expect(table.name).toBe("table");
      expect(table.body).not.toBeNull();
    });

    test("parses table with column widths", () => {
      const result = parseSource("@table(widths: [1in, 2in])");
      const table = result.cst.children[0] as CSTDirective;
      expect(table.name).toBe("table");
      expect(table.arguments.length).toBeGreaterThan(0);
    });
  });

  describe("numbered items (@@)", () => {
    test("parses @@ as list", () => {
      const result = parseSource("@@ First item\n@@ Second item");
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.ordered).toBe(true);
      expect(list.items.length).toBe(2);
    });

    test("parses @@ with style marker", () => {
      const result = parseSource("@@a Item one");
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.items[0]!.marker).toBe("2|a"); // level 2, alpha style
    });

    test("parses legal numbering @@1.1", () => {
      const result = parseSource("@@1.1 Sub-section");
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.items[0]!.marker).toBe("2|1.1"); // level 2, decimal_sub style
    });

    test("parses deep legal numbering @@@2.1.3", () => {
      const result = parseSource("@@@2.1.3 Deep item");
      const list = result.cst.children[0] as CSTList;
      expect(list.type).toBe("List");
      expect(list.items[0]!.marker).toBe("3|2.1.3"); // level 3, decimal_sub style
    });

    test("treats '1. text' at line start as plain text, not list", () => {
      const result = parseSource("1. The name of the trust is:");
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      const text = para.content.map(c => c.type === "Text" ? c.value : "").join("");
      expect(text).toContain("1. The name");
    });
  });

  describe("defined terms", () => {
    test('parses "Term" as defined term in text', () => {
      const result = parseSource('This defines the "Contract".');
      const para = result.cst.children[0] as CSTParagraph;
      const term = para.content.find(c => c.type === "DefinedTerm") as CSTDefinedTerm;
      expect(term).toBeDefined();
      expect(term.term).toBe("Contract");
    });
  });

  describe("blanks (fill-in)", () => {
    test("parses ___ as blank", () => {
      const result = parseSource("Name: ___");
      const para = result.cst.children[0] as CSTParagraph;
      const blank = para.content.find(c => c.type === "Blank") as CSTBlank;
      expect(blank).toBeDefined();
      expect(blank.width).toBe(3);
    });
  });

  describe("footnote definitions", () => {
    test("parses [^label]: as footnote definition", () => {
      const result = parseSource("[^note]: This is the footnote content.");
      const footnoteDef = result.cst.children[0] as CSTFootnoteDef;
      expect(footnoteDef.type).toBe("FootnoteDef");
      expect(footnoteDef.label).toBe("note");
    });
  });
});
