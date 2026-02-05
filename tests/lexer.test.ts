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

    test("tokenizes newlines", () => {
      const result = tokenize("Line 1\nLine 2");
      const types = result.tokens.map(t => t.type);
      expect(types).toContain(TokenType.NEWLINE);
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
  });

  describe("inline formatting", () => {
    test("tokenizes bold markers", () => {
      const result = tokenize("**bold**");
      const types = result.tokens.map(t => t.type);
      expect(types.filter(t => t === TokenType.BOLD_START).length).toBe(2);
    });

    test("tokenizes italic markers", () => {
      const result = tokenize("*italic*");
      const types = result.tokens.map(t => t.type);
      expect(types.filter(t => t === TokenType.ITALIC_START).length).toBe(2);
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
      const result = tokenize("[@target]");
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
});
