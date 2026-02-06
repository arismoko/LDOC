# Error-Tolerant Parser Plan

## Mission Statement

Transform the LDOC parser into a **professional-grade, error-tolerant parser** that:

- **Never crashes** - Always produces a valid CST, even for malformed input
- **Preserves structure** - Partial nodes are usable by LSP for completions, hover, etc.
- **Pinpoints errors** - Diagnostics are precise and actionable
- **Enables future features** - Semantic tokens, hover info, incremental parsing

---

## Industry Reference

How production parsers handle errors:

| Parser         | Approach                              | Key Pattern                      |
| -------------- | ------------------------------------- | -------------------------------- |
| TypeScript     | Synthetic tokens + error nodes        | `createMissingNode()`            |
| Rust Analyzer  | Lossless CST, errors are nodes        | `ERROR` node in rowan            |
| Tree-sitter    | `ERROR` nodes contain garbage         | Grammar-level error productions  |
| Go             | Sync to statement boundary            | `syncStmt()`, `syncDecl()`       |
| Roslyn (C#)    | Missing tokens + skipped trivia       | `SyntaxFactory.MissingToken()`   |

**Common patterns we will adopt:**
1. `CSTError` node for unrecoverable regions
2. `incomplete` flag for partial-but-valid nodes
3. Synchronization to known-good boundaries
4. Continue parsing after errors (collect, don't throw)

---

## Architecture: Error Recovery Levels

```
Level 0: LEXER (already tolerant)
         ↓ Emits tokens even for malformed input
         
Level 1: SYNCHRONIZATION
         ↓ Skip to next safe point on error
         ↓ Safe points: NEWLINE, DEDENT, @directive, #heading
         
Level 2: LOCAL RECOVERY  
         ↓ Handle missing delimiters: ), }}, ]
         ↓ Create partial nodes with incomplete flag
         
Level 3: ERROR NODES
         ↓ Wrap unrecoverable garbage in CSTError
         ↓ Preserve tokens for diagnostics
```

---

## CST Type Changes

### New Types

```typescript
// src/types/cst.ts

/**
 * Error node - contains tokens that couldn't be parsed.
 * Used for unrecoverable regions; preserves source for diagnostics.
 */
export interface CSTError extends CSTBase {
  type: "Error";
  message: string;
  context: ErrorContext;
  tokens: Token[];           // Raw tokens in error region
  partialNode?: CSTNode;     // If we partially parsed something
}

export type ErrorContext =
  | "directive"
  | "directive_args"
  | "directive_body"
  | "interpolation"
  | "inline"
  | "block"
  | "unknown";

/**
 * Marker for incomplete nodes - usable by LSP.
 */
export interface IncompleteMarker {
  incomplete: true;
  missing: MissingElement[];
}

export type MissingElement =
  | { kind: "token"; expected: string }      // e.g., ")"
  | { kind: "body"; directive: string }      // e.g., "@if needs body"
  | { kind: "expression" };                  // e.g., "{{" needs expression
```

### Extended Node Types

```typescript
// Extend existing nodes with optional incomplete marker
export interface CSTDirective extends CSTBase {
  type: "Directive";
  name: string;
  arguments: CSTArgument[];
  body: CSTNode[] | null;
  incomplete?: IncompleteMarker;  // NEW
}

export interface CSTVariable extends CSTBase {
  type: "Variable";
  expression: string;
  incomplete?: IncompleteMarker;  // NEW
}

export interface CSTFootnoteRef extends CSTBase {
  type: "FootnoteRef";
  label: string;
  incomplete?: IncompleteMarker;  // NEW
}

// Update unions - CSTError can appear at both block and inline levels
export type CSTNode =
  | CSTDocument
  | CSTDirective
  | CSTBlock
  | CSTInline
  | CSTError;  // NEW

export type CSTInline =
  | CSTText
  | CSTBold
  | CSTItalic
  | CSTCode
  | CSTLink
  | CSTImage
  | CSTVariable
  | CSTError;  // NEW - inline errors

// Type guard for incomplete nodes
export function isIncomplete(node: CSTNode): node is CSTNode & { incomplete: IncompleteMarker } {
  return "incomplete" in node && node.incomplete !== undefined;
}
```

**Note**: Diagnostics remain in `ParseResult.diagnostics`, not added to `CSTDocument`. This keeps the CST pure and diagnostics separate.

---

## Implementation Phases

### Phase 1: Infrastructure

**Goal**: Add error recovery infrastructure without changing parse behavior.

**Deliverables**:
1. `CSTError` and `IncompleteMarker` types in `src/types/cst.ts`
2. `ErrorRecovery` utility class in `src/parse/recovery.ts`
3. Sync point detection logic
4. Tests for sync point identification

**Key Code**:

```typescript
// src/parse/recovery.ts

import type { Token, TokenType } from "../types/tokens";

/**
 * Tokens that start a new top-level construct.
 * Safe to resume parsing after syncing to these.
 */
const SYNC_TOKENS: TokenType[] = [
  "DIRECTIVE",
  "HEADER_MARKER", 
  "BULLET",
  "NUMBERED_ITEM",
  "FOOTNOTE_DEF",
  "DEDENT",
];

/**
 * Tokens that end the current construct.
 * Safe to stop recovery at these.
 */
const BOUNDARY_TOKENS: TokenType[] = [
  "NEWLINE",
  "DEDENT",
  "EOF",
];

export class ErrorRecovery {
  constructor(
    private tokens: Token[],
    private current: number,
  ) {}

  /**
   * Check if token is a synchronization point.
   */
  isSyncPoint(token: Token): boolean {
    return SYNC_TOKENS.includes(token.type);
  }

  /**
   * Check if token is a boundary (end of construct).
   */
  isBoundary(token: Token): boolean {
    return BOUNDARY_TOKENS.includes(token.type);
  }

  /**
   * Find next sync point, returning tokens to skip.
   */
  findNextSync(from: number): { syncIndex: number; skipped: Token[] } {
    const skipped: Token[] = [];
    let i = from;

    while (i < this.tokens.length) {
      const token = this.tokens[i]!;
      
      if (this.isSyncPoint(token)) {
        return { syncIndex: i, skipped };
      }
      
      if (this.isBoundary(token)) {
        // Include boundary in skipped, sync after it
        skipped.push(token);
        return { syncIndex: i + 1, skipped };
      }

      skipped.push(token);
      i++;
    }

    return { syncIndex: this.tokens.length, skipped };
  }
}
```

**Verification**:
- [ ] Types compile
- [ ] Recovery class has unit tests
- [ ] No behavior change in parser yet

**Effort**: 3 hours

---

### Phase 2: Synchronization

**Goal**: Parser never throws. On error, sync to next safe point and continue.

**Deliverables**:
1. `synchronize()` method in Parser class
2. Wrap `parseNode()` in try-catch, emit `CSTError` on failure
3. Diagnostic collection instead of throwing
4. Tests for multi-error documents

**Key Changes**:

```typescript
// src/parse/parser.ts

export class Parser {
  private recovery: ErrorRecovery;
  private recovering = false;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.recovery = new ErrorRecovery(tokens, 0);
  }

  /**
   * Synchronize to next safe parse point.
   * Called after encountering an error.
   */
  private synchronize(): Token[] {
    const { syncIndex, skipped } = this.recovery.findNextSync(this.current);
    this.current = syncIndex;
    this.recovering = false;
    return skipped;
  }

  /**
   * Main parse loop - now with error recovery.
   */
  parse(): CSTDocument {
    const children: CSTNode[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const node = this.parseNodeSafe();
      if (node) {
        children.push(node);
      }
    }

    return {
      type: "Document",
      children,
      loc: this.documentLoc(),
      diagnostics: this.diagnostics,
    };
  }

  /**
   * Parse a node with error recovery.
   */
  private parseNodeSafe(): CSTNode | null {
    const startToken = this.peek();
    
    try {
      return this.parseNode();
    } catch (e) {
      // Create error diagnostic
      const message = e instanceof Error ? e.message : "Unexpected error";
      this.diagnostics.push(
        error(DiagnosticCode.PARSE_ERROR, message, this.currentLoc())
      );

      // Synchronize and wrap skipped tokens in error node
      const skipped = this.synchronize();
      
      if (skipped.length === 0) {
        return null;
      }

      return {
        type: "Error",
        message,
        context: this.inferErrorContext(startToken),
        tokens: skipped,
        loc: this.spanLoc(startToken, skipped[skipped.length - 1]!),
      };
    }
  }

  /**
   * Infer error context from starting token.
   */
  private inferErrorContext(token: Token): ErrorContext {
    switch (token.type) {
      case "DIRECTIVE": return "directive";
      case "INTERPOLATION_START": return "interpolation";
      case "HEADER_MARKER": return "block";
      default: return "unknown";
    }
  }
}
```

**Verification**:
- [ ] Parser never throws (fuzz test with random input)
- [ ] Multi-error documents produce multiple diagnostics
- [ ] Error nodes contain correct token spans
- [ ] Valid documents still parse correctly (regression)

**Effort**: 4 hours

---

### Phase 3: Local Recovery - Delimiters

**Goal**: Handle unclosed delimiters gracefully, producing partial nodes.

**Target Constructs**:
1. `@directive(args` → unclosed `(`
2. `{{variable` → unclosed `}}`
3. `[^footnote` → unclosed `]`
4. `[link text](url` → unclosed `)`
5. `@table` / `@row` / `@cell` with malformed bodies → sync to next row/cell directive

**Deliverables**:
1. `parseArgumentsWithRecovery()` - handles unclosed `(`
2. `parseInterpolationWithRecovery()` - handles unclosed `}}`
3. `parseFootnoteRefWithRecovery()` - handles unclosed `]`
4. `parseLinkWithRecovery()` - handles unclosed `)`
5. Tests for each incomplete construct

**Note**: Table syntax uses `@table`/`@row`/`@cell` directives, which are already handled by generic directive recovery. No special table-specific recovery needed.

**Key Pattern**:

```typescript
/**
 * Parse directive arguments with recovery.
 * Returns partial args if closing paren is missing.
 */
private parseArgumentsWithRecovery(): { 
  args: CSTArgument[]; 
  incomplete?: IncompleteMarker;
} {
  const args: CSTArgument[] = [];
  
  if (!this.check(TokenType.LPAREN)) {
    return { args };
  }

  const openParen = this.advance(); // (

  while (!this.isAtEnd()) {
    // Success case: found closing paren
    if (this.check(TokenType.RPAREN)) {
      this.advance();
      return { args };
    }

    // Error case: hit boundary without closing paren
    if (this.recovery.isBoundary(this.peek())) {
      this.diagnostics.push(
        error(
          DiagnosticCode.UNCLOSED_DELIMITER,
          "Missing closing ')'",
          this.locFrom(openParen)
        )
      );
      return {
        args,
        incomplete: {
          incomplete: true,
          missing: [{ kind: "token", expected: ")" }],
        },
      };
    }

    // Parse argument
    const arg = this.parseArgument();
    if (arg) {
      args.push(arg);
    }

    // Consume comma or break
    if (this.check(TokenType.COMMA)) {
      this.advance();
    } else if (!this.check(TokenType.RPAREN)) {
      // Unexpected token - skip it
      this.advance();
    }
  }

  // EOF without closing
  return {
    args,
    incomplete: {
      incomplete: true,
      missing: [{ kind: "token", expected: ")" }],
    },
  };
}
```

**Verification**:
- [ ] `@use(name` parses with `incomplete: true`
- [ ] `{{var` parses with `incomplete: true`
- [ ] `[^fn` parses with `incomplete: true`
- [ ] Complete constructs still have no `incomplete` flag
- [ ] LSP can detect incomplete nodes

**Effort**: 4 hours

---

### Phase 4: Local Recovery - Bodies

**Goal**: Handle missing or incomplete directive bodies.

**Target Constructs**:
1. `@if(cond)` without body → missing body
2. `@define name` without body → missing body
3. `@foreach(x in list)` without body → missing body
4. Indented body with errors → partial body

**Key Pattern**:

```typescript
/**
 * Parse directive body with recovery.
 */
private parseBodyWithRecovery(directiveName: string): {
  body: CSTNode[];
  incomplete?: IncompleteMarker;
} {
  const body: CSTNode[] = [];

  // Check for body start (NEWLINE + INDENT or inline content)
  if (!this.checkBodyStart()) {
    // No body - might be incomplete or might be intentional
    if (this.directiveRequiresBody(directiveName)) {
      return {
        body: [],
        incomplete: {
          incomplete: true,
          missing: [{ kind: "body", directive: directiveName }],
        },
      };
    }
    return { body };
  }

  // Consume NEWLINE if present
  if (this.check(TokenType.NEWLINE)) {
    this.advance();
  }

  // Expect INDENT for block body
  if (!this.check(TokenType.INDENT)) {
    return { body };
  }
  this.advance(); // INDENT

  // Parse body nodes until DEDENT
  while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
    const node = this.parseNodeSafe(); // Use safe version
    if (node) {
      body.push(node);
    }
  }

  // Consume DEDENT
  if (this.check(TokenType.DEDENT)) {
    this.advance();
  }

  return { body };
}

private directiveRequiresBody(name: string): boolean {
  return ["if", "elseif", "else", "foreach", "repeat", "define", "style"].includes(name);
}
```

**Verification**:
- [ ] `@if(x)` without body has `incomplete: true`
- [ ] `@define foo` without body has `incomplete: true`
- [ ] Bodies with internal errors still produce partial CST
- [ ] Nested directives with errors recover correctly

**Effort**: 3 hours

---

### Phase 5: Inline Recovery

**Goal**: Handle errors in inline content without losing the paragraph.

**Target Constructs**:
1. `**bold without close` → partial bold
2. `*italic without close` → partial italic
3. `[link text` without url → partial link
4. Mixed inline errors

**Key Pattern**:

```typescript
/**
 * Parse inline content with recovery.
 * Returns partial nodes for unclosed formatting.
 */
private parseInlineWithRecovery(): CSTInline[] {
  const inlines: CSTInline[] = [];
  const openFormatters: { type: string; startIndex: number }[] = [];

  while (!this.isAtEnd() && !this.isBlockBoundary()) {
    const token = this.peek();

    switch (token.type) {
      case TokenType.BOLD_MARKER:
        if (this.hasOpenFormatter("bold", openFormatters)) {
          // Close it
          this.closeFormatter("bold", inlines, openFormatters);
        } else {
          // Open it
          openFormatters.push({ type: "bold", startIndex: inlines.length });
        }
        this.advance();
        break;

      // ... similar for other formatters

      case TokenType.NEWLINE:
      case TokenType.EOF:
        // End of inline region - close any open formatters as incomplete
        this.closeAllFormattersAsIncomplete(inlines, openFormatters);
        return inlines;

      default:
        inlines.push(this.parseInlineToken());
    }
  }

  // Close remaining formatters as incomplete
  this.closeAllFormattersAsIncomplete(inlines, openFormatters);
  return inlines;
}
```

**Verification**:
- [ ] `**bold` produces bold node with `incomplete: true`
- [ ] `**bold *italic` produces nested partials correctly
- [ ] Valid inline content unchanged
- [ ] Paragraphs with inline errors still produce content

**Effort**: 3 hours

---

### Phase 6: Integration & Polish

**Goal**: Ensure all recovery paths work together, update binder/LSP.

**Deliverables**:
1. Binder handles `CSTError` nodes (skip or warn)
2. LSP uses `incomplete` flag for smart completions
3. Comprehensive test suite
4. Documentation

**Binder Changes**:

```typescript
// src/bind/binder.ts

private visitNode(node: CSTNode): void {
  // Skip error nodes - they have no symbols
  if (node.type === "Error") {
    return;
  }

  // ... rest of binding logic
}
```

**Evaluator Changes**:

```typescript
// src/evaluate/evaluator.ts

private evaluateNode(node: CSTNode): IRNode | null {
  // Skip error nodes - they produce no output
  if (node.type === "Error") {
    return null;
  }

  // ... rest of evaluation logic
}
```

**LSP Usage**:

```typescript
// src/lsp/completion.ts

function getCompletionContext(cst: CSTDocument, position: Position): CompletionContext {
  const node = findNodeAtPosition(cst, position);
  if (!node) return { kind: "none" };

  // Check for incomplete nodes - these are completion opportunities
  if ("incomplete" in node && node.incomplete) {
    return contextFromIncompleteNode(node);
  }

  // ... normal context detection
}

function contextFromIncompleteNode(node: CSTNode & { incomplete: IncompleteMarker }): CompletionContext {
  const missing = node.incomplete.missing[0];
  
  if (!missing) return { kind: "none" };

  switch (missing.kind) {
    case "token":
      if (missing.expected === ")" && node.type === "Directive") {
        if (node.name === "use") {
          return { kind: "macro_param", macroName: getPartialMacroName(node) };
        }
        if (node.name === "ref") {
          return { kind: "cross_ref", prefix: getPartialRef(node) };
        }
      }
      break;

    case "expression":
      return { kind: "variable", prefix: getPartialExpression(node) };
  }

  return { kind: "none" };
}
```

**Verification**:
- [ ] Binder doesn't crash on error nodes
- [ ] LSP completions work for all incomplete node types
- [ ] End-to-end test: type `@use(` → get macro completions
- [ ] End-to-end test: type `{{` → get variable completions
- [ ] Performance: no regression on valid documents

**Effort**: 4 hours

---

## Verification Protocol

After each phase:

1. **Run parser tests**: `bun test tests/parse.test.ts`
2. **Run binder tests**: `bun test tests/bind.test.ts`
3. **Typecheck**: `bunx tsc -p tsconfig.json`
4. **Fuzz test**: Random input never crashes parser
5. **Regression test**: Valid documents produce identical CST

### Fuzz Testing Strategy

Create `tests/parse-fuzz.test.ts` with:

1. **Random bytes**: Feed completely random data
2. **Token shuffling**: Generate valid tokens, randomize order
3. **Mutation testing**: Take valid documents, randomly delete/insert characters
4. **Grammar-aware fuzzing**: Generate syntactically plausible but semantically broken input

```typescript
// tests/parse-fuzz.test.ts
import { describe, test, expect } from "bun:test";
import { parseSource } from "../src/parse";

describe("Parser Fuzz Tests", () => {
  test("never crashes on random bytes", () => {
    for (let i = 0; i < 1000; i++) {
      const randomBytes = crypto.getRandomValues(new Uint8Array(Math.random() * 500));
      const input = new TextDecoder().decode(randomBytes);
      
      // Should never throw
      expect(() => parseSource(input)).not.toThrow();
    }
  });

  test("never crashes on mutated valid documents", () => {
    const validDoc = "@define foo\n  Hello world\n\n@use(foo)";
    
    for (let i = 0; i < 500; i++) {
      const mutated = mutateString(validDoc);
      expect(() => parseSource(mutated)).not.toThrow();
    }
  });
});

function mutateString(s: string): string {
  const mutations = [
    () => s.slice(0, Math.random() * s.length), // truncate
    () => s + String.fromCharCode(Math.random() * 128), // append
    () => s.replace(/./g, c => Math.random() > 0.9 ? '' : c), // delete chars
    () => s.split('').sort(() => Math.random() - 0.5).join(''), // shuffle
  ];
  return mutations[Math.floor(Math.random() * mutations.length)]!();
}
```

---

## Effort Summary

| Phase | Description                  | Effort  |
| ----- | ---------------------------- | ------- |
| 1     | Infrastructure               | 3 hours |
| 2     | Synchronization              | 5 hours |
| 3     | Local Recovery - Delimiters  | 5 hours |
| 4     | Local Recovery - Bodies      | 3 hours |
| 5     | Inline Recovery              | 5 hours |
| 6     | Integration & Polish         | 5 hours |
| **Total** |                              | **26 hours** |

*Note: Estimates adjusted per Oracle review - inline recovery and retrofitting existing parser are more complex than initially estimated.*

---

## Success Criteria

The error-tolerant parser is complete when:

1. **Never crashes** - Any input produces a valid CST
2. **Preserves maximum structure** - Partial nodes have correct types
3. **Precise diagnostics** - Each error has accurate location
4. **LSP integration** - Completions work in incomplete contexts
5. **No regressions** - Valid documents parse identically
6. **Tested thoroughly** - Fuzz tests, edge cases, integration tests

---

## Commands

```bash
# Run parser tests
bun test tests/parse.test.ts

# Run all tests
bun test tests/

# Typecheck
bunx tsc -p tsconfig.json

# Fuzz test (after implementation)
bun test tests/parse-fuzz.test.ts
```

---

## Let's Begin

Phase 1 starts now. First deliverable: CST type extensions in `src/types/cst.ts`
