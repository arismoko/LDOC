/**
 * Parser tests
 */

import { describe, test, expect } from "bun:test";
import { parseSource } from "../src/parse/index.ts";
import type { CSTDirective, CSTHeader, CSTParagraph, CSTList } from "../src/types/cst.ts";

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
      const result = parseSource("See [@section]");
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
});
