/**
 * Parser Error Recovery Tests (Phase 2)
 *
 * Tests for synchronization-based error recovery.
 * Ensures parser never throws and produces CSTError nodes for broken input.
 */

import { describe, test, expect } from "bun:test";
import { parseSource } from "../src/parse/index.ts";
import type { CSTDirective, CSTError, CSTHeader, CSTParagraph, CSTVariable, CSTFootnoteRef, CSTLink, CSTEmphasis } from "../src/types/cst.ts";
import { isError, isIncomplete } from "../src/types/cst.ts";

describe("Parser Error Recovery", () => {
  describe("regression - valid documents unchanged", () => {
    test("parses valid document without errors", () => {
      const result = parseSource(`
@document(title: "Test")

# Heading

This is a paragraph with **bold** and *italic*.

- List item 1
- List item 2

@define(macro)
  Content here
`);
      expect(result.diagnostics).toHaveLength(0);
      expect(result.cst.children.every((n) => !isError(n))).toBe(true);
    });

    test("parses directive with complete arguments", () => {
      const result = parseSource('@use(myMacro, param: "value")');
      expect(result.diagnostics).toHaveLength(0);
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("use");
    });

    test("parses nested directives", () => {
      const result = parseSource(`
@if(condition)
  @foreach(item in items)
    {{ item }}
`);
      expect(result.diagnostics).toHaveLength(0);
      const ifDir = result.cst.children[0] as CSTDirective;
      expect(ifDir.type).toBe("Directive");
      expect(ifDir.name).toBe("if");
      expect(ifDir.body).not.toBeNull();
      expect(ifDir.body!.length).toBeGreaterThan(0);
    });
  });

  describe("error node generation", () => {
    test("error nodes have correct type", () => {
      // Manually test isError type guard
      const errorNode: CSTError = {
        type: "Error",
        message: "test",
        context: "unknown",
        tokens: [],
        loc: { line: 1, column: 0, endLine: 1, endColumn: 0 },
      };
      expect(isError(errorNode)).toBe(true);
    });
  });

  describe("multi-error documents", () => {
    test("continues parsing after sync point", () => {
      // This is a valid document - just testing parser doesn't crash
      const result = parseSource(`
@define(first)
  content

@define(second)
  more content
`);
      // Should produce valid CST
      expect(result.cst.type).toBe("Document");
      expect(result.cst.children.length).toBeGreaterThan(0);
    });

    test("parses multiple directives successfully", () => {
      const result = parseSource(`
@document(title: "Test")

@define(macro1)
  First macro

# Heading

@define(macro2)
  Second macro
`);
      expect(result.cst.type).toBe("Document");
      // Should have multiple children
      expect(result.cst.children.length).toBeGreaterThan(2);
    });
  });

  describe("never crashes", () => {
    test("handles completely empty input", () => {
      expect(() => parseSource("")).not.toThrow();
    });

    test("handles whitespace-only input", () => {
      expect(() => parseSource("   \n\n  \t  \n")).not.toThrow();
    });

    test("handles directive without name gracefully", () => {
      // This should not crash, even if malformed
      expect(() => parseSource("@")).not.toThrow();
    });

    test("handles unclosed patterns gracefully", () => {
      // Various unclosed patterns - parser should not crash
      expect(() => parseSource("@directive(")).not.toThrow();
      expect(() => parseSource("{{")).not.toThrow();
      expect(() => parseSource("{{var")).not.toThrow();
      expect(() => parseSource("[^")).not.toThrow();
      expect(() => parseSource("**bold")).not.toThrow();
      expect(() => parseSource("*italic")).not.toThrow();
    });

    test("handles deeply nested structures", () => {
      const deeplyNested = `
@if(a)
  @if(b)
    @if(c)
      @if(d)
        @if(e)
          content
`;
      expect(() => parseSource(deeplyNested)).not.toThrow();
    });

    test("handles very long lines", () => {
      const longLine = "x".repeat(10000);
      expect(() => parseSource(longLine)).not.toThrow();
    });

    test("handles many blank lines", () => {
      const manyBlanks = "\n".repeat(1000);
      expect(() => parseSource(manyBlanks)).not.toThrow();
    });
  });

  describe("diagnostic collection", () => {
    test("produces ParseResult with cst and diagnostics", () => {
      const result = parseSource("@define(macro)\n  content");
      expect(result).toHaveProperty("cst");
      expect(result).toHaveProperty("diagnostics");
      expect(Array.isArray(result.diagnostics)).toBe(true);
    });

    test("diagnostics have proper structure when present", () => {
      // Valid document should have no diagnostics
      const result = parseSource("Hello world");
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});

describe("Parser Fuzz Tests", () => {
  function mutateString(s: string): string {
    const mutations = [
      () => s.slice(0, Math.floor(Math.random() * s.length)), // truncate
      () => s + String.fromCharCode(Math.floor(Math.random() * 128)), // append
      () =>
        s
          .split("")
          .filter(() => Math.random() > 0.1)
          .join(""), // delete chars
      () =>
        s
          .split("")
          .sort(() => Math.random() - 0.5)
          .join(""), // shuffle
      () => s.replace(/./g, (c) => (Math.random() > 0.9 ? "" : c)), // sparse delete
    ];
    const mutation = mutations[Math.floor(Math.random() * mutations.length)]!;
    return mutation();
  }

  test("never crashes on random bytes", () => {
    // Re-enabled after lexer hardening (fixed single { and ~ infinite loops)
    for (let i = 0; i < 100; i++) {
      const randomBytes = crypto.getRandomValues(
        new Uint8Array(Math.floor(Math.random() * 200))
      );
      const input = new TextDecoder("utf-8", { fatal: false }).decode(randomBytes);

      // Should never throw
      expect(() => parseSource(input)).not.toThrow();
    }
  });

  test("never crashes on mutated valid documents", () => {
    // Re-enabled after lexer hardening
    const validDocs = [
      "@define foo\n  Hello world\n\n@use(foo)",
      "# Heading\n\nParagraph with **bold** text.",
      "@if(condition)\n  @foreach(x in list)\n    {{ x }}",
      "- Item 1\n- Item 2\n  - Nested\n- Item 3",
      '@document(title: "Test", author: "Me")',
    ];

    for (const doc of validDocs) {
      for (let i = 0; i < 50; i++) {
        const mutated = mutateString(doc);
        expect(() => parseSource(mutated)).not.toThrow();
      }
    }
  });

  test("never crashes on random directive-like patterns", () => {
    const patterns = [
      "@",
      "@@",
      "@name",
      "@name(",
      "@name(arg",
      "@name(arg,",
      "@name(arg, other",
      "@name(arg, other:",
      "@name(arg, other: value",
      "@name)\n  body",
      "@()",
      "@123",
      "@-invalid",
    ];

    for (const pattern of patterns) {
      expect(() => parseSource(pattern)).not.toThrow();
    }
  });

  test("never crashes on random markdown-like patterns", () => {
    const patterns = [
      "#",
      "##",
      "### ",
      "# Heading\n##",
      "-",
      "- ",
      "- item\n-",
      "1.",
      "1. ",
      "**",
      "***",
      "****",
      "*",
      "*italic",
      "**bold",
      "~~",
      "~~strike",
      "[",
      "[text",
      "[text]",
      "[text](",
      "[text](url",
      "![",
      "![alt]",
      "![alt](src",
      "[^",
      "[^note",
      "[^note]",
      "[@",
      "[@ref",
      "{{",
      "{{ var",
      "{{ var }",
    ];

    for (const pattern of patterns) {
      expect(() => parseSource(pattern)).not.toThrow();
    }
  });

  test("produces valid CST structure even for garbage", () => {
    const garbage = "!@#$%^&*()_+{}|:<>?~`-=[]\\;',./\n\n\n\t\t\t";
    const result = parseSource(garbage);

    expect(result.cst.type).toBe("Document");
    expect(Array.isArray(result.cst.children)).toBe(true);
  });
});

describe("Error node spans", () => {
  test("CST location spans are consistent", () => {
    const result = parseSource("# Heading\n\nParagraph text");
    
    for (const node of result.cst.children) {
      expect(node.loc).toBeDefined();
      expect(typeof node.loc.line).toBe("number");
      expect(typeof node.loc.column).toBe("number");
      expect(typeof node.loc.endLine).toBe("number");
      expect(typeof node.loc.endColumn).toBe("number");
      expect(node.loc.line).toBeGreaterThan(0);
      expect(node.loc.endLine).toBeGreaterThanOrEqual(node.loc.line);
    }
  });

  test("header location is correct", () => {
    const result = parseSource("# Test Heading");
    const header = result.cst.children[0] as CSTHeader;
    
    expect(header.type).toBe("Header");
    expect(header.loc.line).toBe(1);
    expect(header.loc.column).toBe(0);
  });

  test("paragraph location is correct", () => {
    const result = parseSource("Simple paragraph");
    const para = result.cst.children[0] as CSTParagraph;
    
    expect(para.type).toBe("Paragraph");
    expect(para.loc.line).toBe(1);
    expect(para.loc.column).toBe(0);
  });
});

// =============================================================================
// Phase 3: Delimiter Recovery Tests
// =============================================================================

describe("Phase 3: Unclosed Delimiter Recovery", () => {
  describe("unclosed directive arguments", () => {
    test("@use(name without closing paren has incomplete marker", () => {
      const result = parseSource("@use(myMacro\n");
      
      // Should have one directive
      expect(result.cst.children.length).toBeGreaterThanOrEqual(1);
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("use");
      
      // Should have incomplete marker
      expect(directive.incomplete).toBeDefined();
      expect(directive.incomplete?.incomplete).toBe(true);
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: ")",
      });
      
      // Should have UNCLOSED_DELIMITER diagnostic
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics.some(d => d.code === "P007")).toBe(true);
    });

    test("@directive(arg1, arg2 without closing paren preserves args", () => {
      const result = parseSource("@define(macro, param1, param2\n");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("define");
      
      // Should have parsed args
      expect(directive.arguments.length).toBe(3);
      
      // Should have incomplete marker
      expect(directive.incomplete).toBeDefined();
    });

    test("@if(condition without paren parses and continues", () => {
      const result = parseSource(`@if(x
@define(y)
  body
`);
      
      // First directive should be incomplete @if
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(ifDirective.name).toBe("if");
      expect(ifDirective.incomplete).toBeDefined();
      
      // Second directive should parse correctly
      const defineDirective = result.cst.children[1] as CSTDirective;
      expect(defineDirective.type).toBe("Directive");
      expect(defineDirective.name).toBe("define");
      expect(defineDirective.incomplete).toBeUndefined();
    });

    test("complete directives have no incomplete marker", () => {
      const result = parseSource('@use(myMacro, param: "value")');
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("use");
      expect(directive.incomplete).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    test("@directive( with empty args and no close", () => {
      const result = parseSource("@empty(\n");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.type).toBe("Directive");
      expect(directive.name).toBe("empty");
      expect(directive.arguments).toHaveLength(0);
      expect(directive.incomplete).toBeDefined();
    });

    test("isIncomplete type guard works correctly", () => {
      // Complete directive
      const complete = parseSource("@use(macro)");
      const completeDir = complete.cst.children[0] as CSTDirective;
      expect(isIncomplete(completeDir)).toBe(false);
      
      // Incomplete directive
      const incomplete = parseSource("@use(macro\n");
      const incompleteDir = incomplete.cst.children[0] as CSTDirective;
      expect(isIncomplete(incompleteDir)).toBe(true);
    });

    test("nested incomplete directive", () => {
      const result = parseSource(`@if(outer)
  @foreach(item in items
    content
`);
      
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(ifDirective.name).toBe("if");
      // The body should contain the incomplete foreach
      expect(ifDirective.body).not.toBeNull();
      expect(ifDirective.body!.length).toBeGreaterThan(0);
    });
  });

  describe("unclosed variable expressions", () => {
    test("{{variable without close has incomplete marker", () => {
      const result = parseSource("Hello {{name\nworld");
      
      // Should have diagnostic for unclosed variable
      expect(result.diagnostics.some(d => d.code === "P004")).toBe(true);
      
      // Find the paragraph with the variable
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      
      // Find the variable in the content
      const variable = para.content.find(n => n.type === "Variable") as CSTVariable | undefined;
      expect(variable).toBeDefined();
      expect(variable!.expression).toBe("name");
      
      // Should have incomplete marker
      expect(variable!.incomplete).toBeDefined();
      expect(variable!.incomplete?.incomplete).toBe(true);
      expect(variable!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "}}",
      });
    });

    test("complete variable has no incomplete marker", () => {
      const result = parseSource("Hello {{name}}");
      
      const para = result.cst.children[0] as CSTParagraph;
      const variable = para.content.find(n => n.type === "Variable") as CSTVariable | undefined;
      expect(variable).toBeDefined();
      expect(variable!.incomplete).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    test("isIncomplete works for variables", () => {
      // Complete variable
      const complete = parseSource("{{name}}");
      const completePara = complete.cst.children[0] as CSTParagraph;
      const completeVar = completePara.content.find(n => n.type === "Variable")!;
      expect(isIncomplete(completeVar)).toBe(false);
      
      // Incomplete variable  
      const incomplete = parseSource("{{name\n");
      const incompletePara = incomplete.cst.children[0] as CSTParagraph;
      const incompleteVar = incompletePara.content.find(n => n.type === "Variable")!;
      expect(isIncomplete(incompleteVar)).toBe(true);
    });
  });

  describe("unclosed footnote references", () => {
    test("[^footnote without close has incomplete marker", () => {
      const result = parseSource("See [^note text continues here");
      
      // Should have diagnostic for unclosed footnote
      expect(result.diagnostics.some(d => d.code === "P007")).toBe(true);
      
      // Find the paragraph
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      
      // Find the footnote ref
      const footnote = para.content.find(n => n.type === "FootnoteRef") as CSTFootnoteRef | undefined;
      expect(footnote).toBeDefined();
      
      // Should have incomplete marker
      expect(footnote!.incomplete).toBeDefined();
      expect(footnote!.incomplete?.incomplete).toBe(true);
      expect(footnote!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "]",
      });
    });

    test("complete footnote has no incomplete marker", () => {
      const result = parseSource("See [^note] for details");
      
      const para = result.cst.children[0] as CSTParagraph;
      const footnote = para.content.find(n => n.type === "FootnoteRef") as CSTFootnoteRef | undefined;
      expect(footnote).toBeDefined();
      expect(footnote!.incomplete).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    test("isIncomplete works for footnotes", () => {
      // Complete footnote
      const complete = parseSource("[^note]");
      const completePara = complete.cst.children[0] as CSTParagraph;
      const completeNote = completePara.content.find(n => n.type === "FootnoteRef")!;
      expect(isIncomplete(completeNote)).toBe(false);
      
      // Incomplete footnote
      const incomplete = parseSource("[^note\n");
      const incompletePara = incomplete.cst.children[0] as CSTParagraph;
      const incompleteNote = incompletePara.content.find(n => n.type === "FootnoteRef")!;
      expect(isIncomplete(incompleteNote)).toBe(true);
    });
  });

  describe("unclosed links", () => {
    test("[link](url without close has incomplete marker", () => {
      const result = parseSource("Click [here](http://example.com/path");
      
      // Should have diagnostic for unclosed link
      expect(result.diagnostics.some(d => d.code === "P007")).toBe(true);
      
      // Find the paragraph
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      
      // Find the link
      const link = para.content.find(n => n.type === "Link") as CSTLink | undefined;
      expect(link).toBeDefined();
      expect(link!.url).toBe("http://example.com/path");
      
      // Should have incomplete marker
      expect(link!.incomplete).toBeDefined();
      expect(link!.incomplete?.incomplete).toBe(true);
      expect(link!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: ")",
      });
    });

    test("complete link has no incomplete marker", () => {
      const result = parseSource("Click [here](http://example.com)");
      
      const para = result.cst.children[0] as CSTParagraph;
      const link = para.content.find(n => n.type === "Link") as CSTLink | undefined;
      expect(link).toBeDefined();
      expect(link!.incomplete).toBeUndefined();
      expect(result.diagnostics).toHaveLength(0);
    });

    test("isIncomplete works for links", () => {
      // Complete link
      const complete = parseSource("[text](url)");
      const completePara = complete.cst.children[0] as CSTParagraph;
      const completeLink = completePara.content.find(n => n.type === "Link")!;
      expect(isIncomplete(completeLink)).toBe(false);
      
      // Incomplete link
      const incomplete = parseSource("[text](url\n");
      const incompletePara = incomplete.cst.children[0] as CSTParagraph;
      const incompleteLink = incompletePara.content.find(n => n.type === "Link")!;
      expect(isIncomplete(incompleteLink)).toBe(true);
    });
  });
});

describe("Phase 3: Consistency - All incomplete markers use same API", () => {
  test("all 4 constructs emit incomplete marker with same structure", () => {
    // Directive
    const directive = parseSource("@use(arg\n");
    const dir = directive.cst.children[0] as CSTDirective;
    expect(dir.incomplete?.incomplete).toBe(true);
    expect(dir.incomplete?.missing[0]?.kind).toBe("token");
    
    // Variable
    const variable = parseSource("{{expr\n");
    const varPara = variable.cst.children[0] as CSTParagraph;
    const varNode = varPara.content.find(n => n.type === "Variable") as CSTVariable;
    expect(varNode.incomplete?.incomplete).toBe(true);
    expect(varNode.incomplete?.missing[0]?.kind).toBe("token");
    
    // Footnote
    const footnote = parseSource("[^note\n");
    const footPara = footnote.cst.children[0] as CSTParagraph;
    const footNode = footPara.content.find(n => n.type === "FootnoteRef") as CSTFootnoteRef;
    expect(footNode.incomplete?.incomplete).toBe(true);
    expect(footNode.incomplete?.missing[0]?.kind).toBe("token");
    
    // Link
    const link = parseSource("[text](url\n");
    const linkPara = link.cst.children[0] as CSTParagraph;
    const linkNode = linkPara.content.find(n => n.type === "Link") as CSTLink;
    expect(linkNode.incomplete?.incomplete).toBe(true);
    expect(linkNode.incomplete?.missing[0]?.kind).toBe("token");
  });

  test("isIncomplete type guard works for all 4 constructs", () => {
    // All should return true for incomplete versions
    const dirResult = parseSource("@use(arg\n");
    expect(isIncomplete(dirResult.cst.children[0]!)).toBe(true);
    
    const varResult = parseSource("{{expr\n");
    const varPara = varResult.cst.children[0] as CSTParagraph;
    expect(isIncomplete(varPara.content.find(n => n.type === "Variable")!)).toBe(true);
    
    const footResult = parseSource("[^note\n");
    const footPara = footResult.cst.children[0] as CSTParagraph;
    expect(isIncomplete(footPara.content.find(n => n.type === "FootnoteRef")!)).toBe(true);
    
    const linkResult = parseSource("[text](url\n");
    const linkPara = linkResult.cst.children[0] as CSTParagraph;
    expect(isIncomplete(linkPara.content.find(n => n.type === "Link")!)).toBe(true);
    
    // All should return false for complete versions
    const completeDir = parseSource("@use(arg)");
    expect(isIncomplete(completeDir.cst.children[0]!)).toBe(false);
    
    const completeVar = parseSource("{{expr}}");
    const completeVarPara = completeVar.cst.children[0] as CSTParagraph;
    expect(isIncomplete(completeVarPara.content.find(n => n.type === "Variable")!)).toBe(false);
    
    const completeFoot = parseSource("[^note]");
    const completeFootPara = completeFoot.cst.children[0] as CSTParagraph;
    expect(isIncomplete(completeFootPara.content.find(n => n.type === "FootnoteRef")!)).toBe(false);
    
    const completeLink = parseSource("[text](url)");
    const completeLinkPara = completeLink.cst.children[0] as CSTParagraph;
    expect(isIncomplete(completeLinkPara.content.find(n => n.type === "Link")!)).toBe(false);
  });

  test("LSP can use incomplete marker to determine cursor context", () => {
    // Simulate LSP completion scenarios
    
    // User typing directive arg: @use(myMac|
    const dirResult = parseSource("@use(myMac\n");
    const dir = dirResult.cst.children[0] as CSTDirective;
    expect(dir.incomplete).toBeDefined();
    expect(dir.arguments.length).toBe(1); // Partial arg captured
    
    // User typing variable: {{user.na|
    const varResult = parseSource("{{user.na\n");
    const varPara = varResult.cst.children[0] as CSTParagraph;
    const varNode = varPara.content.find(n => n.type === "Variable") as CSTVariable;
    expect(varNode.incomplete).toBeDefined();
    expect(varNode.expression).toBe("user.na"); // Partial expression captured
    
    // User typing footnote: [^my-no|
    const footResult = parseSource("[^my-no\n");
    const footPara = footResult.cst.children[0] as CSTParagraph;
    const footNode = footPara.content.find(n => n.type === "FootnoteRef") as CSTFootnoteRef;
    expect(footNode.incomplete).toBeDefined();
    expect(footNode.label).toBe("my-no"); // Partial label captured
    
    // User typing link URL: [click](https://exa|
    const linkResult = parseSource("[click](https://exa\n");
    const linkPara = linkResult.cst.children[0] as CSTParagraph;
    const linkNode = linkPara.content.find(n => n.type === "Link") as CSTLink;
    expect(linkNode.incomplete).toBeDefined();
    expect(linkNode.url).toBe("https://exa"); // Partial URL captured
  });
});

// =============================================================================
// Phase 4: Body Recovery Tests
// =============================================================================

describe("Phase 4: Missing Body Recovery", () => {
  describe("missing body detection", () => {
    test("@if(condition) without body has incomplete marker", () => {
      const result = parseSource("@if(x)\n@define(y)\n  content");
      
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(ifDirective.type).toBe("Directive");
      expect(ifDirective.name).toBe("if");
      expect(ifDirective.body).toBeNull();
      
      // Should have incomplete marker for missing body
      expect(ifDirective.incomplete).toBeDefined();
      expect(ifDirective.incomplete?.incomplete).toBe(true);
      expect(ifDirective.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "if",
      });
    });

    test("@define(name) without body has incomplete marker", () => {
      const result = parseSource("@define(macro)\n# Heading");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("define");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeDefined();
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "define",
      });
    });

    test("@foreach(x in list) without body has incomplete marker", () => {
      const result = parseSource("@foreach(item in items)\nSome text");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("foreach");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeDefined();
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "foreach",
      });
    });

    test("@elseif(cond) without body has incomplete marker", () => {
      const result = parseSource("@if(a)\n  content\n@elseif(b)\n@else\n  other");
      
      // Find the elseif directive
      const children = result.cst.children;
      const elseifDirective = children.find(
        (n) => n.type === "Directive" && (n as CSTDirective).name === "elseif"
      ) as CSTDirective;
      
      expect(elseifDirective).toBeDefined();
      expect(elseifDirective.body).toBeNull();
      expect(elseifDirective.incomplete).toBeDefined();
      expect(elseifDirective.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "elseif",
      });
    });

    test("@else without body has incomplete marker", () => {
      const result = parseSource("@if(a)\n  content\n@else\n");
      
      const elseDirective = result.cst.children.find(
        (n) => n.type === "Directive" && (n as CSTDirective).name === "else"
      ) as CSTDirective;
      
      expect(elseDirective).toBeDefined();
      expect(elseDirective.body).toBeNull();
      expect(elseDirective.incomplete).toBeDefined();
      expect(elseDirective.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "else",
      });
    });

    test("@repeat(n) without body has incomplete marker", () => {
      const result = parseSource("@repeat(3)\nSome text");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("repeat");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeDefined();
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "repeat",
      });
    });

    test("@style(bold) without body has incomplete marker", () => {
      const result = parseSource("@style(bold: true)\nParagraph");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("style");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeDefined();
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "body",
        directive: "style",
      });
    });
  });

  describe("directives that don't require body", () => {
    test("@use(macro) without body has NO incomplete marker", () => {
      const result = parseSource("@use(myMacro)\nSome text");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("use");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeUndefined();
    });

    test("@document(title) without body has NO incomplete marker", () => {
      const result = parseSource('@document(title: "Test")\nContent');
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("document");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeUndefined();
    });

    test("@ref(target) without body has NO incomplete marker", () => {
      const result = parseSource("@ref(section-1)\nMore text");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("ref");
      expect(directive.body).toBeNull();
      expect(directive.incomplete).toBeUndefined();
    });
  });

  describe("complete directives with body", () => {
    test("@if(x) with body has NO incomplete marker", () => {
      const result = parseSource("@if(condition)\n  Body content here");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("if");
      expect(directive.body).not.toBeNull();
      expect(directive.body!.length).toBeGreaterThan(0);
      expect(directive.incomplete).toBeUndefined();
    });

    test("@define(macro) with body has NO incomplete marker", () => {
      const result = parseSource("@define(myMacro)\n  Macro body");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("define");
      expect(directive.body).not.toBeNull();
      expect(directive.incomplete).toBeUndefined();
    });

    test("@foreach with body has NO incomplete marker", () => {
      const result = parseSource("@foreach(item in items)\n  {{ item }}");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("foreach");
      expect(directive.body).not.toBeNull();
      expect(directive.incomplete).toBeUndefined();
    });
  });

  describe("argument incompleteness takes precedence", () => {
    test("@if(condition with unclosed paren marks as missing delimiter, not body", () => {
      const result = parseSource("@if(x\n@define(y)\n  content");
      
      const directive = result.cst.children[0] as CSTDirective;
      expect(directive.name).toBe("if");
      expect(directive.incomplete).toBeDefined();
      // Should report missing ")" not missing body
      expect(directive.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: ")",
      });
    });
  });

  describe("bodies with internal errors", () => {
    test("directive body with error continues parsing", () => {
      const result = parseSource(`@if(condition)
  Valid paragraph
  @broken(arg
  Another paragraph
`);
      
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(ifDirective.name).toBe("if");
      expect(ifDirective.body).not.toBeNull();
      // Body should contain multiple nodes - some may be errors
      expect(ifDirective.body!.length).toBeGreaterThan(0);
    });

    test("nested directives with missing bodies", () => {
      const result = parseSource(`@if(outer)
  @foreach(x in list)
  Missing foreach body
`);
      
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(ifDirective.name).toBe("if");
      expect(ifDirective.body).not.toBeNull();
      
      // The foreach inside should be incomplete
      const foreach = ifDirective.body?.find(
        (n) => n.type === "Directive" && (n as CSTDirective).name === "foreach"
      ) as CSTDirective | undefined;
      
      // Note: depending on parsing, foreach may have caught subsequent content
      expect(foreach).toBeDefined();
    });

    test("list item with error in nested content recovers", () => {
      const result = parseSource(`- Item 1
  @broken(incomplete
  More nested text
- Item 2
`);
      
      // Should parse without throwing
      expect(result.cst.type).toBe("Document");
      // Should have nodes
      expect(result.cst.children.length).toBeGreaterThan(0);
    });
  });

  describe("isIncomplete type guard works for body markers", () => {
    test("isIncomplete detects missing body", () => {
      const result = parseSource("@if(x)\n@use(y)");
      
      const ifDirective = result.cst.children[0] as CSTDirective;
      expect(isIncomplete(ifDirective)).toBe(true);
      
      const useDirective = result.cst.children[1] as CSTDirective;
      expect(isIncomplete(useDirective)).toBe(false);
    });

    test("missing elements have correct structure", () => {
      const result = parseSource("@define(macro)\n@foreach(x in y)\n");
      
      for (const child of result.cst.children) {
        if (child.type === "Directive" && isIncomplete(child)) {
          const directive = child as CSTDirective;
          expect(directive.incomplete?.incomplete).toBe(true);
          expect(Array.isArray(directive.incomplete?.missing)).toBe(true);
          
          const missing = directive.incomplete!.missing[0];
          expect(missing).toBeDefined();
          expect(missing!.kind).toBe("body");
          if (missing && missing.kind === "body") {
            expect(["define", "foreach"]).toContain(missing.directive);
          }
        }
      }
    });
  });
});

// =============================================================================
// Phase 5: Inline Recovery Tests
// =============================================================================

describe("Phase 5: Unclosed Inline Formatter Recovery", () => {
  describe("unclosed bold", () => {
    test("**bold without close has incomplete marker", () => {
      const result = parseSource("This is **bold text\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      
      // Find the emphasis node
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("bold");
      
      // Should have incomplete marker
      expect(emphasis!.incomplete).toBeDefined();
      expect(emphasis!.incomplete?.incomplete).toBe(true);
      expect(emphasis!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "**",
      });
    });

    test("complete **bold** has NO incomplete marker", () => {
      const result = parseSource("This is **bold** text");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("bold");
      expect(emphasis!.incomplete).toBeUndefined();
    });
  });

  describe("unclosed italic", () => {
    test("*italic without close has incomplete marker", () => {
      const result = parseSource("This is *italic text\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("italic");
      
      // Should have incomplete marker
      expect(emphasis!.incomplete).toBeDefined();
      expect(emphasis!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "*",
      });
    });

    test("complete *italic* has NO incomplete marker", () => {
      const result = parseSource("This is *italic* text");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("italic");
      expect(emphasis!.incomplete).toBeUndefined();
    });
  });

  describe("unclosed strikethrough", () => {
    test("~~strike without close has incomplete marker", () => {
      const result = parseSource("This is ~~strikethrough text\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("strikethrough");
      
      // Should have incomplete marker
      expect(emphasis!.incomplete).toBeDefined();
      expect(emphasis!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "~~",
      });
    });

    test("complete ~~strike~~ has NO incomplete marker", () => {
      const result = parseSource("This is ~~strike~~ text");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("strikethrough");
      expect(emphasis!.incomplete).toBeUndefined();
    });
  });

  describe("unclosed highlight", () => {
    test("==highlight without close has incomplete marker", () => {
      const result = parseSource("This is ==highlighted text\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("highlight");
      
      // Should have incomplete marker
      expect(emphasis!.incomplete).toBeDefined();
      expect(emphasis!.incomplete?.missing).toContainEqual({
        kind: "token",
        expected: "==",
      });
    });

    test("complete ==highlight== has NO incomplete marker", () => {
      const result = parseSource("This is ==highlight== text");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(emphasis).toBeDefined();
      expect(emphasis!.kind).toBe("highlight");
      expect(emphasis!.incomplete).toBeUndefined();
    });
  });

  describe("nested unclosed formatters", () => {
    test("**bold with nested *italic both unclosed", () => {
      const result = parseSource("**bold *italic\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      
      // Outer bold should be incomplete
      const bold = para.content.find(n => n.type === "Emphasis" && (n as CSTEmphasis).kind === "bold") as CSTEmphasis | undefined;
      expect(bold).toBeDefined();
      expect(bold!.incomplete).toBeDefined();
      
      // Inner italic (inside bold content) should also be incomplete
      const italic = bold!.content.find(n => n.type === "Emphasis" && (n as CSTEmphasis).kind === "italic") as CSTEmphasis | undefined;
      expect(italic).toBeDefined();
      expect(italic!.incomplete).toBeDefined();
    });

    test("**bold *closed italic* but bold unclosed", () => {
      const result = parseSource("**bold *italic* more\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      
      // Outer bold should be incomplete
      const bold = para.content.find(n => n.type === "Emphasis" && (n as CSTEmphasis).kind === "bold") as CSTEmphasis | undefined;
      expect(bold).toBeDefined();
      expect(bold!.incomplete).toBeDefined();
      
      // Inner italic should be complete
      const italic = bold!.content.find(n => n.type === "Emphasis" && (n as CSTEmphasis).kind === "italic") as CSTEmphasis | undefined;
      expect(italic).toBeDefined();
      expect(italic!.incomplete).toBeUndefined();
    });
  });

  describe("mixed inline content with unclosed formatter", () => {
    test("paragraph with text, unclosed bold, and more text continues", () => {
      const result = parseSource("Before **bold without close");
      
      const para = result.cst.children[0] as CSTParagraph;
      expect(para.type).toBe("Paragraph");
      expect(para.content.length).toBeGreaterThan(0);
      
      // Should have both text nodes and emphasis
      const hasText = para.content.some(n => n.type === "Text");
      const hasEmphasis = para.content.some(n => n.type === "Emphasis");
      expect(hasText).toBe(true);
      expect(hasEmphasis).toBe(true);
    });

    test("unclosed formatter with variable inside", () => {
      const result = parseSource("**bold with {{var}} inside\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      const bold = para.content.find(n => n.type === "Emphasis") as CSTEmphasis | undefined;
      expect(bold).toBeDefined();
      expect(bold!.incomplete).toBeDefined();
      
      // Variable inside should still be present
      const variable = bold!.content.find(n => n.type === "Variable");
      expect(variable).toBeDefined();
    });
  });

  describe("isIncomplete type guard for emphasis", () => {
    test("isIncomplete detects unclosed emphasis", () => {
      const result = parseSource("**unclosed bold\n");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis")!;
      expect(isIncomplete(emphasis)).toBe(true);
    });

    test("isIncomplete returns false for closed emphasis", () => {
      const result = parseSource("**closed bold**");
      
      const para = result.cst.children[0] as CSTParagraph;
      const emphasis = para.content.find(n => n.type === "Emphasis")!;
      expect(isIncomplete(emphasis)).toBe(false);
    });
  });

  describe("all emphasis kinds produce consistent markers", () => {
    test("all 4 emphasis types have same incomplete structure", () => {
      const cases = [
        { input: "**bold\n", kind: "bold", expected: "**" },
        { input: "*italic\n", kind: "italic", expected: "*" },
        { input: "~~strike\n", kind: "strikethrough", expected: "~~" },
        { input: "==highlight\n", kind: "highlight", expected: "==" },
      ];
      
      for (const { input, kind, expected } of cases) {
        const result = parseSource(input);
        const para = result.cst.children[0] as CSTParagraph;
        const emphasis = para.content.find(
          n => n.type === "Emphasis" && (n as CSTEmphasis).kind === kind
        ) as CSTEmphasis | undefined;
        
        expect(emphasis).toBeDefined();
        expect(emphasis!.incomplete?.incomplete).toBe(true);
        expect(emphasis!.incomplete?.missing[0]).toEqual({
          kind: "token",
          expected,
        });
      }
    });
  });
});

