/**
 * Tests for the lexer — escape sequences (Spec §3.3).
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "./lexer.ts";
import { TokenType } from "../types/tokens.ts";

describe("Lexer escape sequences (§3.3)", () => {
  test("\\@ produces literal @ as TEXT", () => {
    const { tokens } = tokenize("[\\@]");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.length).toBe(1);
    expect(textTokens[0]!.value).toBe("@");
  });

  test("\\$ produces literal $ (no Lua expression)", () => {
    const { tokens } = tokenize("[\\$(hello)]");
    // Should produce TEXT "$" then the rest as normal tokens, NOT a LUA_EXPR_OPEN
    const luaTokens = tokens.filter((t) => t.type === TokenType.LUA_EXPR_OPEN);
    expect(luaTokens.length).toBe(0);
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "$")).toBe(true);
  });

  test("\\[ produces literal [ as TEXT (not PARA_OPEN)", () => {
    const { tokens } = tokenize("[\\[]");
    const paraOpenTokens = tokens.filter((t) => t.type === TokenType.PARA_OPEN);
    // Only the outer [ should be PARA_OPEN
    expect(paraOpenTokens.length).toBe(1);
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "[")).toBe(true);
  });

  test("\\] produces literal ] as TEXT (not PARA_CLOSE)", () => {
    const { tokens } = tokenize("[a\\]b]");
    // The \\] should not close the paragraph — only the final ] should
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "]")).toBe(true);
    // Only one PARA_CLOSE for the outer ]
    const paraCloseTokens = tokens.filter((t) => t.type === TokenType.PARA_CLOSE);
    expect(paraCloseTokens.length).toBe(1);
  });

  test("\\{ and \\} produce literal braces", () => {
    const { tokens } = tokenize("[\\{\\}]");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "{")).toBe(true);
    expect(textTokens.some((t) => t.value === "}")).toBe(true);
  });

  test("\\( and \\) produce literal parens", () => {
    const { tokens } = tokenize("[\\(\\)]");
    const lparenTokens = tokens.filter((t) => t.type === TokenType.LPAREN);
    const rparenTokens = tokens.filter((t) => t.type === TokenType.RPAREN);
    expect(lparenTokens.length).toBe(0);
    expect(rparenTokens.length).toBe(0);
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "(")).toBe(true);
    expect(textTokens.some((t) => t.value === ")")).toBe(true);
  });

  test("\\\\ produces literal backslash", () => {
    const { tokens } = tokenize("[\\\\]");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "\\")).toBe(true);
  });

  test("unknown \\X produces literal \\X", () => {
    const { tokens } = tokenize("[\\n]");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "\\n")).toBe(true);
  });

  test("trailing backslash at EOF produces literal backslash", () => {
    const { tokens } = tokenize("\\");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    expect(textTokens.some((t) => t.value === "\\")).toBe(true);
  });
});

describe("Lexer single slash handling", () => {
  test("single / is tokenized as TEXT (no infinite loop)", () => {
    const { tokens } = tokenize("[a/b]");
    const textTokens = tokens.filter((t) => t.type === TokenType.TEXT);
    // Only "/" should be TEXT; "a" and "b" are IDENTIFIER tokens
    expect(textTokens.length).toBe(1);
    expect(textTokens[0]!.value).toBe("/");
  });

  test("// is still a comment", () => {
    const { tokens } = tokenize("// this is a comment");
    const commentTokens = tokens.filter((t) => t.type === TokenType.COMMENT);
    expect(commentTokens.length).toBe(1);
    expect(commentTokens[0]!.value).toBe(" this is a comment");
  });
});

describe("Lexer // in paragraph context (§3.2)", () => {
  test("// inside [] does not swallow closing bracket", () => {
    const { tokens } = tokenize("[text // more ] text]");
    // The ] should be tokenized as PARA_CLOSE, not consumed by the comment
    const paraCloseTokens = tokens.filter((t) => t.type === TokenType.PARA_CLOSE);
    expect(paraCloseTokens.length).toBeGreaterThanOrEqual(1);
  });

  test("[text // comment] closes correctly", () => {
    const { tokens } = tokenize("[text // comment]");
    const paraCloseTokens = tokens.filter((t) => t.type === TokenType.PARA_CLOSE);
    expect(paraCloseTokens.length).toBe(1);
    // Comment should not include the ] bracket
    const commentTokens = tokens.filter((t) => t.type === TokenType.COMMENT);
    expect(commentTokens.length).toBe(1);
    expect(commentTokens[0]!.value).not.toContain("]");
  });

  test("// outside [] still consumes to end of line", () => {
    const { tokens } = tokenize("// full line comment\n@document");
    const commentTokens = tokens.filter((t) => t.type === TokenType.COMMENT);
    expect(commentTokens.length).toBe(1);
    expect(commentTokens[0]!.value).toBe(" full line comment");
    const directiveTokens = tokens.filter((t) => t.type === TokenType.DIRECTIVE);
    expect(directiveTokens.length).toBe(1);
  });
});

describe("Lexer unterminated strings", () => {
  test("unterminated string emits diagnostic", () => {
    const { tokens, diagnostics } = tokenize('@style(ref: "h1)');
    // Should still emit a STRING token
    const stringTokens = tokens.filter((t) => t.type === TokenType.STRING);
    expect(stringTokens.length).toBe(1);
    // Should emit a warning diagnostic
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some((d) => d.message.includes("nterminated"))).toBe(true);
  });

  test("terminated string emits no diagnostic", () => {
    const { diagnostics } = tokenize('@style(ref: "h1")');
    expect(diagnostics.length).toBe(0);
  });
});

describe("Lexer @lua tokenization (§7.2)", () => {
  test("@lua{ tokenizes as DIRECTIVE + LBRACE, not a special token", () => {
    const { tokens } = tokenize("@lua{x = 1}");
    const directives = tokens.filter((t) => t.type === TokenType.DIRECTIVE);
    expect(directives.length).toBe(1);
    expect(directives[0]!.value).toBe("lua");
    const lbraces = tokens.filter((t) => t.type === TokenType.LBRACE);
    expect(lbraces.length).toBe(1);
  });

  test("@lua(args){body} tokenizes as DIRECTIVE + LPAREN/RPAREN + LBRACE", () => {
    const { tokens } = tokenize("@lua(once){print('hi')}");
    const types = tokens.map((t) => t.type);
    expect(types[0]).toBe(TokenType.DIRECTIVE);
    expect(types[1]).toBe(TokenType.LPAREN);
  });
});

describe("Lexer STRING quote preservation", () => {
  test("double-quoted string stores quote char", () => {
    const { tokens } = tokenize('"hello"');
    const str = tokens.find((t) => t.type === TokenType.STRING);
    expect(str!.value).toBe("hello");
    expect(str!.quote).toBe('"');
  });

  test("single-quoted string stores quote char", () => {
    const { tokens } = tokenize("'hello'");
    const str = tokens.find((t) => t.type === TokenType.STRING);
    expect(str!.value).toBe("hello");
    expect(str!.quote).toBe("'");
  });

  test("single-quoted string with embedded double quotes preserves content", () => {
    const { tokens } = tokenize("'he said \"hello\"'");
    const str = tokens.find((t) => t.type === TokenType.STRING);
    expect(str!.value).toBe('he said "hello"');
    expect(str!.quote).toBe("'");
  });
});

describe("Lexer comment text preservation", () => {
  test("comment preserves leading whitespace", () => {
    const { tokens } = tokenize("//  indented comment");
    const comment = tokens.find((t) => t.type === TokenType.COMMENT);
    expect(comment!.value).toBe("  indented comment");
  });

  test("comment with no space after // preserves empty prefix", () => {
    const { tokens } = tokenize("//tight");
    const comment = tokens.find((t) => t.type === TokenType.COMMENT);
    expect(comment!.value).toBe("tight");
  });
});
