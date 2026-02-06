/**
 * Error Recovery Utilities
 * 
 * Provides synchronization and recovery mechanisms for the parser.
 * Used to skip over malformed input and resume parsing at known-good points.
 */

import { TokenType, type Token } from "../types/tokens.ts";

/**
 * Tokens that start a new top-level construct.
 * Safe to resume parsing after syncing to these.
 * 
 * Note: DEDENT is NOT here - it ends blocks, doesn't start them.
 * DEDENT belongs in BOUNDARY_TOKENS only.
 */
export const SYNC_TOKENS: TokenType[] = [
  TokenType.DIRECTIVE,
  TokenType.HEADER_MARKER,
  TokenType.BULLET,
  TokenType.NUMBERED,
  TokenType.NUMBERED_ITEM,
  TokenType.FOOTNOTE_DEF,
];

/**
 * Tokens that end the current construct.
 * Safe to stop recovery at these.
 */
export const BOUNDARY_TOKENS: TokenType[] = [
  TokenType.NEWLINE,
  TokenType.DEDENT,
  TokenType.EOF,
];

/**
 * Error recovery helper for the parser.
 * Provides methods to find synchronization points and handle recovery.
 */
export class ErrorRecovery {
  constructor(
    private tokens: Token[],
    private current: number,
  ) {}

  /**
   * Update the current position.
   * Called by the parser when position changes.
   */
  updatePosition(current: number): void {
    this.current = current;
  }

  /**
   * Check if token is a synchronization point.
   * Sync points are tokens that can start a new top-level construct.
   */
  isSyncPoint(token: Token): boolean {
    return SYNC_TOKENS.includes(token.type);
  }

  /**
   * Check if token is a boundary (end of construct).
   * Recovery should stop at boundaries.
   */
  isBoundary(token: Token): boolean {
    return BOUNDARY_TOKENS.includes(token.type);
  }

  /**
   * Check if a specific token type is a boundary.
   */
  isBoundaryType(type: TokenType): boolean {
    return BOUNDARY_TOKENS.includes(type);
  }

  /**
   * Find next sync point, returning tokens to skip.
   * 
   * Scans forward from the given position to find either:
   * 1. A sync point (start of new construct) - stops before it
   * 2. A boundary token (end of construct) - includes it in skipped
   * 
   * @param from - Position to start scanning from
   * @returns Object with sync index and skipped tokens
   */
  findNextSync(from: number): { syncIndex: number; skipped: Token[] } {
    const skipped: Token[] = [];
    let i = from;

    while (i < this.tokens.length) {
      const token = this.tokens[i];
      if (!token) break;

      // Sync point found - stop before it
      if (this.isSyncPoint(token)) {
        return { syncIndex: i, skipped };
      }

      // Boundary found - include in skipped, sync after it
      if (this.isBoundary(token)) {
        skipped.push(token);
        return { syncIndex: i + 1, skipped };
      }

      skipped.push(token);
      i++;
    }

    // Reached end of tokens
    return { syncIndex: this.tokens.length, skipped };
  }

  /**
   * Find the next occurrence of a specific token type.
   * Useful for local recovery (finding closing delimiters).
   * 
   * @param type - Token type to find
   * @param from - Position to start scanning from
   * @param stopAtBoundary - If true, stop at boundary tokens
   * @returns Token index or -1 if not found
   */
  findNextToken(type: TokenType, from: number, stopAtBoundary = true): number {
    for (let i = from; i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (!token) continue;

      if (token.type === type) {
        return i;
      }

      if (stopAtBoundary && this.isBoundary(token)) {
        return -1;
      }
    }
    return -1;
  }

  /**
   * Collect tokens between two positions.
   * 
   * @param from - Start position (inclusive)
   * @param to - End position (exclusive)
   * @returns Array of tokens in the range
   */
  collectTokens(from: number, to: number): Token[] {
    const tokens: Token[] = [];
    for (let i = from; i < to && i < this.tokens.length; i++) {
      const token = this.tokens[i];
      if (token) {
        tokens.push(token);
      }
    }
    return tokens;
  }

  /**
   * Check if we're at a position where recovery should stop.
   * This includes EOF and dedent.
   */
  shouldStopRecovery(position: number): boolean {
    const token = this.tokens[position];
    if (!token) return true;
    return token.type === TokenType.EOF || token.type === TokenType.DEDENT;
  }
}
