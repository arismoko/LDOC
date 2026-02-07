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
    expect(commentTokens[0]!.value).toBe("this is a comment");
  });
});
