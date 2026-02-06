/**
 * Basic lexer tests
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "../src/parse/lexer.ts";
import { TokenType } from "../src/types/tokens.ts";

describe("Lexer", () => {
  describe("basic tokens", () => {
    test("tokenizes empty input", () => {
      const result = tokenize("");
      expect(result.tokens.length).toBe(1);
      expect(result.tokens[0]!.type).toBe(TokenType.EOF);
    });

    test("tokenizes plain text", () => {
      const result = tokenize("Hello world");
      expect(result.tokens[0]!.type).toBe(TokenType.TEXT);
      expect(result.tokens[0]!.value).toBe("Hello world");
    });

    test("tokenizes paragraph breaks", () => {
      const result = tokenize("Line 1\n\nLine 2");
      const types = result.tokens.map(t => t.type);
      expect(types).toContain(TokenType.PARA_BREAK);
    });

    test("single newlines do not produce tokens", () => {
      const result = tokenize("Line 1\nLine 2");
      const types = result.tokens.map(t => t.type);
      expect(types).not.toContain(TokenType.PARA_BREAK);
      expect(types).not.toContain(TokenType.EMPTY_PARAGRAPH);
    });

    test("tokenizes directives", () => {
      const result = tokenize("@document");
      expect(result.tokens[0]!.type).toBe(TokenType.DIRECTIVE);
      expect(result.tokens[0]!.value).toBe("document");
    });

    test("tokenizes headers", () => {
      const result = tokenize("# Heading");
      expect(result.tokens[0]!.type).toBe(TokenType.HEADER_MARKER);
      expect(result.tokens[0]!.value).toBe("#");
    });

    test("tokenizes multiple header levels", () => {
      const result = tokenize("### Level 3");
      expect(result.tokens[0]!.type).toBe(TokenType.HEADER_MARKER);
      expect(result.tokens[0]!.value).toBe("###");
    });
  });

  describe("indentation", () => {
    test("emits INDENT for increased indentation", () => {
      const result = tokenize("Parent\n  Child");
      const types = result.tokens.map(t => t.type);
      expect(types).toContain(TokenType.INDENT);
    });

    test("emits DEDENT for decreased indentation", () => {
      const result = tokenize("Parent\n  Child\nSibling");
      const types = result.tokens.map(t => t.type);
      expect(types).toContain(TokenType.INDENT);
      expect(types).toContain(TokenType.DEDENT);
    });

    test("tabs count as 4 spaces", () => {
      const result = tokenize("Parent\n\tChild");
      const types = result.tokens.map(t => t.type);
      expect(types).toContain(TokenType.INDENT);
    });

    test("rejects mixed tabs and spaces", () => {
      const result = tokenize("Parent\n \tChild");
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0]!.message).toContain("Mixed tabs and spaces");
    });
  });

  describe("inline formatting", () => {
    test("tokenizes bold markers", () => {
      const result = tokenize("**bold**");
      const types = result.tokens.map(t => t.type);
      expect(types.filter(t => t === TokenType.BOLD_MARKER).length).toBe(2);
    });

    test("tokenizes italic markers", () => {
      const result = tokenize("*italic*");
      const types = result.tokens.map(t => t.type);
      expect(types.filter(t => t === TokenType.ITALIC_MARKER).length).toBe(2);
    });

    test("tokenizes variables", () => {
      const result = tokenize("Hello {{ name }}");
      expect(result.tokens[1]!.type).toBe(TokenType.VARIABLE);
      expect(result.tokens[1]!.value).toBe("name");
    });
  });

  describe("special elements", () => {
    test("tokenizes horizontal rule", () => {
      const result = tokenize("---");
      expect(result.tokens[0]!.type).toBe(TokenType.HORIZONTAL_RULE);
    });

    test("tokenizes bullet", () => {
      const result = tokenize("- Item");
      expect(result.tokens[0]!.type).toBe(TokenType.BULLET);
    });

    test("tokenizes blockquote", () => {
      const result = tokenize("> Quote");
      expect(result.tokens[0]!.type).toBe(TokenType.BLOCKQUOTE);
    });

    test("tokenizes footnote reference", () => {
      const result = tokenize("[^note]");
      expect(result.tokens[0]!.type).toBe(TokenType.FOOTNOTE_REF);
      expect(result.tokens[0]!.value).toBe("note");
    });

    test("tokenizes cross reference", () => {
      const result = tokenize("[[target]]");
      expect(result.tokens[0]!.type).toBe(TokenType.CROSS_REF);
      expect(result.tokens[0]!.value).toBe("target");
    });
  });

  describe("comments", () => {
    test("tokenizes line comments", () => {
      const result = tokenize("// This is a comment");
      expect(result.tokens[0]!.type).toBe(TokenType.COMMENT);
    });
  });

  describe("links", () => {
    test("tokenizes markdown links", () => {
      const result = tokenize("[Click here](https://example.com)");
      expect(result.tokens[0]!.type).toBe(TokenType.LINK);
      expect(result.tokens[0]!.value).toBe("Click here|https://example.com");
    });

    test("tokenizes links with text only", () => {
      const result = tokenize("[text](url)");
      expect(result.tokens[0]!.type).toBe(TokenType.LINK);
      expect(result.tokens[0]!.value).toBe("text|url");
    });

    test("treats non-link brackets as text", () => {
      const result = tokenize("[not a link]");
      expect(result.tokens[0]!.type).toBe(TokenType.TEXT);
    });
  });

  describe("numbered items (@@)", () => {
    test("tokenizes @@ as level 2", () => {
      const result = tokenize("@@ Item");
      expect(result.tokens[0]!.type).toBe(TokenType.NUMBERED_ITEM);
      expect(result.tokens[0]!.value).toBe("2|"); // level 2, no style
    });

    test("tokenizes @@@ as level 3", () => {
      const result = tokenize("@@@ Item");
      expect(result.tokens[0]!.type).toBe(TokenType.NUMBERED_ITEM);
      expect(result.tokens[0]!.value).toBe("3|"); // level 3, no style
    });

    test("tokenizes @@a with style", () => {
      const result = tokenize("@@a Item");
      expect(result.tokens[0]!.type).toBe(TokenType.NUMBERED_ITEM);
      expect(result.tokens[0]!.value).toBe("2|a"); // level 2, alpha style
    });

    test("tokenizes @@1 with numeric style", () => {
      const result = tokenize("@@1 Item");
      expect(result.tokens[0]!.type).toBe(TokenType.NUMBERED_ITEM);
      expect(result.tokens[0]!.value).toBe("2|1"); // level 2, decimal style
    });
  });

  describe("footnote definitions", () => {
    test("tokenizes footnote definition", () => {
      const result = tokenize("[^note]: This is the footnote");
      expect(result.tokens[0]!.type).toBe(TokenType.FOOTNOTE_DEF);
      expect(result.tokens[0]!.value).toBe("note");
    });

    test("distinguishes from footnote reference", () => {
      const result = tokenize("[^note]");
      expect(result.tokens[0]!.type).toBe(TokenType.FOOTNOTE_REF);
    });
  });

  describe("blanks (fill-in lines)", () => {
    test("tokenizes blank with 3 underscores", () => {
      const result = tokenize("Name: ___");
      const blankToken = result.tokens.find(t => t.type === TokenType.BLANK);
      expect(blankToken).toBeDefined();
      expect(blankToken!.value).toBe("___");
    });

    test("tokenizes blank with many underscores", () => {
      const result = tokenize("__________");
      expect(result.tokens[0]!.type).toBe(TokenType.BLANK);
      expect(result.tokens[0]!.value.length).toBe(10);
    });
  });
});
