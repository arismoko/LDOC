// Manages Python-style significant whitespace indentation state for the lexer.

export class IndentationManager {
  private indentStack: number[] = [0];
  private pendingDedents: number = 0;
  private pendingDedentTargetIndent: number | null = null;

  /**
   * Returns the current indentation level (top of stack).
   */
  currentIndent(): number {
    return this.indentStack[this.indentStack.length - 1] ?? 0;
  }

  /**
   * Pushes a new indentation level onto the stack.
   */
  pushIndent(indent: number): void {
    this.indentStack.push(indent);
  }

  /**
   * Pops the top indentation level from the stack.
   * Returns the popped value, or undefined if only the base level remains.
   */
  popIndent(): number | undefined {
    if (this.indentStack.length > 1) {
      return this.indentStack.pop();
    }
    return undefined;
  }

  /**
   * Returns true if the given indent level is less than the current indent.
   */
  shouldDedent(indent: number): boolean {
    return indent < this.currentIndent();
  }

  /**
   * Calculates how many dedents are needed to reach the target indent level.
   */
  calculateDedents(indent: number): number {
    let count = 0;
    for (let i = this.indentStack.length - 1; i > 0; i--) {
      if ((this.indentStack[i] ?? 0) > indent) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Sets pending dedents to be emitted later (used for deferred dedent emission).
   */
  setPendingDedents(count: number, target: number): void {
    this.pendingDedents = count;
    this.pendingDedentTargetIndent = target;
  }

  /**
   * Returns true if there are pending dedents to emit.
   */
  hasPendingDedents(): boolean {
    return this.pendingDedents > 0 && this.pendingDedentTargetIndent !== null;
  }

  /**
   * Pops one pending dedent, updates internal state.
   * Returns the target indent level if there was a pending dedent, null otherwise.
   */
  popPendingDedent(): number | null {
    if (this.pendingDedents > 0 && this.pendingDedentTargetIndent !== null) {
      this.pendingDedents--;
      const target = this.pendingDedentTargetIndent;
      if (this.pendingDedents === 0) {
        this.pendingDedentTargetIndent = null;
      }
      return target;
    }
    return null;
  }

  /**
   * Returns the number of remaining levels in the stack (excluding the base level).
   */
  remainingLevels(): number {
    return this.indentStack.length - 1;
  }

  /**
   * Clears all pending dedents.
   */
  clearPendingDedents(): void {
    this.pendingDedents = 0;
    this.pendingDedentTargetIndent = null;
  }
}
