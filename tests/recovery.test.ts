/**
 * Tests for error recovery utilities.
 */

import { describe, test, expect } from "bun:test";
import { ErrorRecovery, SYNC_TOKENS, BOUNDARY_TOKENS } from "../src/parse/recovery.ts";
import { TokenType, token } from "../src/types/tokens.ts";

// Helper to create test tokens
function makeTokens(...types: TokenType[]): ReturnType<typeof token>[] {
  return types.map((type, i) => token(type, type, 1, i * 5));
}

describe("ErrorRecovery", () => {
  describe("SYNC_TOKENS", () => {
    test("includes all sync point tokens", () => {
      expect(SYNC_TOKENS).toContain(TokenType.DIRECTIVE);
      expect(SYNC_TOKENS).toContain(TokenType.HEADER_MARKER);
      expect(SYNC_TOKENS).toContain(TokenType.BULLET);
      expect(SYNC_TOKENS).toContain(TokenType.NUMBERED_ITEM);
      expect(SYNC_TOKENS).toContain(TokenType.FOOTNOTE_DEF);
    });

    test("does not include DEDENT (it ends blocks, not starts them)", () => {
      expect(SYNC_TOKENS).not.toContain(TokenType.DEDENT);
    });
  });

  describe("BOUNDARY_TOKENS", () => {
    test("includes all boundary tokens", () => {
      expect(BOUNDARY_TOKENS).toContain(TokenType.NEWLINE);
      expect(BOUNDARY_TOKENS).toContain(TokenType.DEDENT);
      expect(BOUNDARY_TOKENS).toContain(TokenType.EOF);
    });
  });

  describe("isSyncPoint", () => {
    test("returns true for sync point tokens", () => {
      const tokens = makeTokens(TokenType.DIRECTIVE);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isSyncPoint(tokens[0]!)).toBe(true);
    });

    test("returns false for non-sync tokens", () => {
      const tokens = makeTokens(TokenType.TEXT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isSyncPoint(tokens[0]!)).toBe(false);
    });

    test("returns true for header marker", () => {
      const tokens = makeTokens(TokenType.HEADER_MARKER);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isSyncPoint(tokens[0]!)).toBe(true);
    });
  });

  describe("isBoundary", () => {
    test("returns true for newline", () => {
      const tokens = makeTokens(TokenType.NEWLINE);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isBoundary(tokens[0]!)).toBe(true);
    });

    test("returns true for dedent", () => {
      const tokens = makeTokens(TokenType.DEDENT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isBoundary(tokens[0]!)).toBe(true);
    });

    test("returns true for EOF", () => {
      const tokens = makeTokens(TokenType.EOF);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isBoundary(tokens[0]!)).toBe(true);
    });

    test("returns false for text", () => {
      const tokens = makeTokens(TokenType.TEXT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.isBoundary(tokens[0]!)).toBe(false);
    });
  });

  describe("findNextSync", () => {
    test("finds sync point and returns skipped tokens", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.VARIABLE,
        TokenType.DIRECTIVE,  // Sync point
        TokenType.TEXT,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(0);

      expect(result.syncIndex).toBe(2);  // Index of DIRECTIVE
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped[0]!.type).toBe(TokenType.TEXT);
      expect(result.skipped[1]!.type).toBe(TokenType.VARIABLE);
    });

    test("stops at boundary and includes it in skipped", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.NEWLINE,  // Boundary
        TokenType.TEXT,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(0);

      expect(result.syncIndex).toBe(2);  // After NEWLINE
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped[0]!.type).toBe(TokenType.TEXT);
      expect(result.skipped[1]!.type).toBe(TokenType.NEWLINE);
    });

    test("returns all remaining tokens if no sync point found", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.VARIABLE,
        TokenType.TEXT,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(0);

      expect(result.syncIndex).toBe(3);  // End of tokens
      expect(result.skipped).toHaveLength(3);
    });

    test("respects from parameter", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.DIRECTIVE,  // Skipped because from=2
        TokenType.TEXT,
        TokenType.HEADER_MARKER,  // Found
      );
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(2);

      expect(result.syncIndex).toBe(3);  // Index of HEADER_MARKER
      expect(result.skipped).toHaveLength(1);  // Only TEXT at index 2
    });

    test("handles empty range", () => {
      const tokens = makeTokens(TokenType.DIRECTIVE);
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(0);

      expect(result.syncIndex).toBe(0);
      expect(result.skipped).toHaveLength(0);
    });

    test("handles scan starting at end of tokens", () => {
      const tokens = makeTokens(TokenType.TEXT, TokenType.EOF);
      const recovery = new ErrorRecovery(tokens, 0);

      const result = recovery.findNextSync(2);

      expect(result.syncIndex).toBe(2);
      expect(result.skipped).toHaveLength(0);
    });
  });

  describe("findNextToken", () => {
    test("finds next occurrence of token type", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.LPAREN,
        TokenType.TEXT,
        TokenType.RPAREN,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.findNextToken(TokenType.RPAREN, 0)).toBe(3);
    });

    test("returns -1 if token not found", () => {
      const tokens = makeTokens(TokenType.TEXT, TokenType.VARIABLE);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.findNextToken(TokenType.RPAREN, 0)).toBe(-1);
    });

    test("stops at boundary when stopAtBoundary is true", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.NEWLINE,  // Boundary
        TokenType.RPAREN,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.findNextToken(TokenType.RPAREN, 0, true)).toBe(-1);
    });

    test("crosses boundary when stopAtBoundary is false", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.NEWLINE,
        TokenType.RPAREN,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.findNextToken(TokenType.RPAREN, 0, false)).toBe(2);
    });
  });

  describe("collectTokens", () => {
    test("collects tokens in range", () => {
      const tokens = makeTokens(
        TokenType.TEXT,
        TokenType.VARIABLE,
        TokenType.DIRECTIVE,
        TokenType.NEWLINE,
      );
      const recovery = new ErrorRecovery(tokens, 0);

      const collected = recovery.collectTokens(1, 3);

      expect(collected).toHaveLength(2);
      expect(collected[0]!.type).toBe(TokenType.VARIABLE);
      expect(collected[1]!.type).toBe(TokenType.DIRECTIVE);
    });

    test("handles empty range", () => {
      const tokens = makeTokens(TokenType.TEXT);
      const recovery = new ErrorRecovery(tokens, 0);

      const collected = recovery.collectTokens(0, 0);

      expect(collected).toHaveLength(0);
    });

    test("handles out of bounds", () => {
      const tokens = makeTokens(TokenType.TEXT, TokenType.VARIABLE);
      const recovery = new ErrorRecovery(tokens, 0);

      const collected = recovery.collectTokens(0, 10);

      expect(collected).toHaveLength(2);
    });
  });

  describe("shouldStopRecovery", () => {
    test("returns true for EOF", () => {
      const tokens = makeTokens(TokenType.EOF);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.shouldStopRecovery(0)).toBe(true);
    });

    test("returns true for DEDENT", () => {
      const tokens = makeTokens(TokenType.DEDENT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.shouldStopRecovery(0)).toBe(true);
    });

    test("returns false for other tokens", () => {
      const tokens = makeTokens(TokenType.TEXT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.shouldStopRecovery(0)).toBe(false);
    });

    test("returns true for out of bounds position", () => {
      const tokens = makeTokens(TokenType.TEXT);
      const recovery = new ErrorRecovery(tokens, 0);

      expect(recovery.shouldStopRecovery(10)).toBe(true);
    });
  });
});

describe("Type Guards", () => {
  // Import type guards
  test("isIncomplete identifies incomplete nodes", async () => {
    const { isIncomplete } = await import("../src/types/cst.ts");
    
    const incompleteNode = {
      type: "Directive" as const,
      name: "use",
      arguments: [],
      body: null,
      loc: { line: 1, column: 0, endLine: 1, endColumn: 10 },
      incomplete: {
        incomplete: true as const,
        missing: [{ kind: "token" as const, expected: ")" }],
      },
    };

    const completeNode = {
      type: "Directive" as const,
      name: "use",
      arguments: [],
      body: null,
      loc: { line: 1, column: 0, endLine: 1, endColumn: 10 },
    };

    expect(isIncomplete(incompleteNode)).toBe(true);
    expect(isIncomplete(completeNode)).toBe(false);
  });

  test("isError identifies error nodes", async () => {
    const { isError } = await import("../src/types/cst.ts");

    const errorNode = {
      type: "Error" as const,
      message: "Unexpected token",
      context: "directive" as const,
      tokens: [],
      loc: { line: 1, column: 0, endLine: 1, endColumn: 10 },
    };

    const normalNode = {
      type: "Directive" as const,
      name: "use",
      arguments: [],
      body: null,
      loc: { line: 1, column: 0, endLine: 1, endColumn: 10 },
    };

    expect(isError(errorNode)).toBe(true);
    expect(isError(normalNode)).toBe(false);
  });
});
