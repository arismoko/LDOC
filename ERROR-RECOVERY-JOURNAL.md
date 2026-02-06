# Error Recovery Journal

Track progress, decisions, and issues during error-tolerant parser implementation.

## Format

```
### [DATE] - Phase N: Description

**Item**: What was done/deferred
**Status**: Complete / In Progress / Deferred / Blocked
**Notes**: Additional context
```

---

## Entries

### 2026-02-05 - Planning Complete

**Item**: Oracle review and comprehensive planning
**Status**: Complete
**Notes**: 
- Analyzed how TypeScript, Rust Analyzer, Tree-sitter handle errors
- Designed 6-phase implementation plan
- Estimated ~21 hours total effort
- Created ERROR-RECOVERY.md with detailed specs

---

### 2026-02-05 - Oracle Review: APPROVED

**Item**: Plan review and refinements
**Status**: Complete
**Notes**:
- Oracle approved the plan as "well-architected, follows industry best practices"
- Identified refinements (all addressed):
  1. ✅ Add `CSTError` to `CSTInline` union (not just block level)
  2. ✅ Add evaluator handling for `CSTError` nodes
  3. ✅ Add table recovery scenario
  4. ✅ Add `isIncomplete()` type guard
  5. ✅ Clarify diagnostics stay in `ParseResult`
  6. ✅ Specify fuzz test strategy
  7. ✅ Adjust effort estimate to ~26 hours

---

### 2026-02-05 - Phase 1: Infrastructure COMPLETE

**Item**: CST type extensions and ErrorRecovery class
**Status**: Complete
**Notes**:
- Added `CSTError`, `IncompleteMarker`, `MissingElement`, `ErrorContext` types to `src/types/cst.ts`
- Added `incomplete` optional field to `CSTDirective`, `CSTVariable`, `CSTFootnoteRef`, `CSTEmphasis`, `CSTLink`
- Updated `CSTNode` and `CSTInline` unions to include `CSTError`
- Added `isIncomplete()` and `isError()` type guards
- Created `src/parse/recovery.ts` with:
  - `SYNC_TOKENS` and `BOUNDARY_TOKENS` constants
  - `ErrorRecovery` class with `isSyncPoint()`, `isBoundary()`, `findNextSync()`, `findNextToken()`, `collectTokens()`, `shouldStopRecovery()`
- Created `tests/recovery.test.ts` with 28 tests for sync point identification
- All 187 tests pass (1 skipped), typecheck passes

---

### 2026-02-05 - Phase 2: Synchronization COMPLETE

**Item**: Parser error recovery with synchronization
**Status**: Complete
**Notes**:
- Added `PARSE_ERROR` diagnostic code to `src/types/diagnostics.ts`
- Integrated `ErrorRecovery` class into `Parser`
- Added `synchronize()` method - uses `ErrorRecovery.findNextSync()` to skip to safe points
- Added `inferErrorContext()` helper - determines context from starting token
- Added `parseNodeSafe()` method - wraps `parseNode()` in try-catch, emits `CSTError` on failure
- Updated `parse()` loop to use `parseNodeSafe()`
- Fixed DEDENT handling at top level (was causing infinite loop when orphaned)
- Fixed lexer infinite loops on single `{` and `~` characters
- Created `tests/parser-recovery.test.ts` with 23 tests (all pass, fuzz tests enabled)
- All 211 tests pass (1 skipped), typecheck passes

**Bugs Fixed During Implementation**:
1. **DEDENT at top level**: `parseNode()` returned null without consuming DEDENT, causing infinite loop. Fixed by consuming stray DEDENTs.
2. **Lexer single `{`**: Fell through to `scanText()` which stops at `{` without consuming. Fixed by emitting TEXT token.
3. **Lexer single `~`**: Same pattern as `{`. Fixed by emitting TEXT token.

**Oracle Verification**:
- DEDENT fix verified correct - all body-parsing loops check for DEDENT before calling `parseNode()`, so consuming is safe
- Comprehensive lexer audit completed - no other infinite loop risks found

---

### 2026-02-05 - Phase 3: Local Recovery - Delimiters COMPLETE

**Item**: Unclosed delimiter recovery with incomplete markers
**Status**: Complete
**Notes**:
- Added `UNCLOSED_DELIMITER` diagnostic code (P007) to `src/types/diagnostics.ts`
- Implemented `parseArgumentsWithRecovery()` in parser for directive arguments
- **Updated for consistency (Oracle recommendation)**: Implemented all 4 constructs with `incomplete` markers:

| Construct      | Implementation                                           | Incomplete Marker                   |
|----------------|----------------------------------------------------------|-------------------------------------|
| `@use(arg`     | Parser-level: `parseArgumentsWithRecovery()`             | `{ kind: "token", expected: ")" }`  |
| `{{expr`       | Lexer: `scanVariable()` emits token with `incomplete` flag | `{ kind: "token", expected: "}}" }` |
| `[^note`       | Lexer: `scanBracket()` emits token with `incomplete` flag  | `{ kind: "token", expected: "]" }`  |
| `[text](url`   | Lexer: `scanLink()` emits token with `incomplete` flag     | `{ kind: "token", expected: ")" }`  |

- Added `incomplete?: boolean` field to `Token` interface
- Parser propagates `incomplete` flag from tokens to CST nodes
- 42 recovery tests passing, 230 total tests pass
- Typecheck passes

**LSP API**:
```typescript
// All 4 constructs now have consistent API:
if (isIncomplete(node)) {
  // node.incomplete.missing tells you what's needed
  for (const missing of node.incomplete.missing) {
    if (missing.kind === "token") {
      console.log(`Missing: ${missing.expected}`);
    }
  }
}
```

**DRY Refactor**:
- Added `missingDelimiter(expected: string)` helper function in parser
- All incomplete marker creation now uses this helper
- Oracle review confirmed architecture is correct:
  - Lexer/Parser separation: ✅ Clean responsibilities
  - Token.incomplete field: ✅ Right place (lexer detects, parser enriches)
  - IncompleteMarker propagation: ✅ Good pattern (flag → structured metadata)

---

### 2026-02-05 - Phase 4: Local Recovery - Bodies COMPLETE

**Item**: Missing directive body detection and body error recovery
**Status**: Complete
**Notes**:
- Added `directiveRequiresBody(name: string)` helper (checks: if, elseif, else, foreach, repeat, define, style)
- Added `missingBody(directive: string)` DRY helper for creating body incomplete markers
- Modified `parseDirective()` to detect missing bodies and emit `incomplete` marker
- Uses `parseNodeSafe()` in body parsing loops for error recovery within bodies
- Updated all body parsing loops to use `parseNodeSafe()`:
  - `parseDirective()` - directive bodies
  - `parseListItem()` - nested list content
  - `parseNumberedItemList()` - nested item content
  - `parseFootnoteDef()` - footnote content

**New Pattern**:
```typescript
// Directive body detection
if (directiveRequiresBody(name) && body === null) {
  directive.incomplete = missingBody(name);
}

// Incomplete marker structure for missing bodies
{
  incomplete: true,
  missing: [{ kind: "body", directive: "if" }]
}
```

**Tests Added**: 19 new tests in `tests/parser-recovery.test.ts`:
- Missing body detection for: @if, @define, @foreach, @elseif, @else, @repeat, @style
- Directives that don't require body: @use, @document, @ref (no false positives)
- Complete directives with body (no incomplete marker)
- Argument incompleteness takes precedence over body incompleteness
- Bodies with internal errors continue parsing
- Nested directives with missing bodies
- List items with errors in nested content

**Verification**:
- [x] `@if(x)` without body has `incomplete: true` with `{ kind: "body", directive: "if" }`
- [x] `@define foo` without body has `incomplete: true`
- [x] Bodies with internal errors still produce partial CST
- [x] Nested directives with errors recover correctly
- [x] Directives that don't require body have no false positives
- [x] 249 tests pass (1 skipped), typecheck passes

---

### 2026-02-05 - Phase 5: Inline Recovery COMPLETE

**Item**: Unclosed inline formatter detection
**Status**: Complete
**Notes**:
- Added `EMPHASIS_DELIMITERS` mapping (bold → "**", italic → "*", strikethrough → "~~", highlight → "==")
- Added `missingFormatter(kind: string)` DRY helper for creating inline incomplete markers
- Modified `parseEmphasis()` to track whether closing marker was found
- If loop exits due to `isBlockEnd()` without finding closing marker, emits incomplete marker

**New Pattern**:
```typescript
// In parseEmphasis()
let foundClosing = false;
while (!this.isAtEnd() && !this.isBlockEnd()) {
  // ... check for closing marker ...
  if (isClosingMarker) {
    foundClosing = true;
    break;
  }
}
if (!foundClosing) {
  emphasis.incomplete = missingFormatter(kind);
}
```

**Tests Added**: 15 new tests in `tests/parser-recovery.test.ts`:
- Unclosed bold, italic, strikethrough, highlight
- Complete formatters have no incomplete marker
- Nested unclosed formatters (both incomplete)
- Nested with only outer unclosed
- Mixed content with unclosed formatter
- Formatter with variable inside
- isIncomplete type guard for emphasis
- All 4 emphasis types produce consistent incomplete structure

**Verification**:
- [x] `**bold` produces bold node with `incomplete: true` and `missing: [{ kind: "token", expected: "**" }]`
- [x] `**bold *italic` produces nested partials correctly
- [x] Valid inline content unchanged
- [x] Paragraphs with inline errors still produce content
- [x] 264 tests pass (1 skipped), typecheck passes

---

## Phase Progress

### Phase 1: Infrastructure
- [x] Add `CSTError` type to `src/types/cst.ts`
- [x] Add `IncompleteMarker` type
- [x] Add `ErrorContext` type
- [x] Add `MissingElement` type
- [x] Add `incomplete` flag to `CSTDirective`, `CSTVariable`, `CSTFootnoteRef`, `CSTEmphasis`, `CSTLink`
- [x] Update `CSTNode` union to include `CSTError`
- [x] Update `CSTInline` union to include `CSTError`
- [x] Add `isIncomplete()` type guard
- [x] Add `isError()` type guard
- [x] Create `src/parse/recovery.ts` with `ErrorRecovery` class
- [x] Unit tests for sync point detection (28 tests passing)

### Phase 2: Synchronization
- [x] Add `synchronize()` method to Parser
- [x] Wrap `parseNode()` with error handling (`parseNodeSafe()`)
- [x] Emit `CSTError` nodes for unrecoverable regions
- [x] Multi-error document tests
- [x] Fuzz test: random input never crashes (partial - lexer hardening needed for full fuzz)
- [x] Fix DEDENT handling at top level (was causing infinite loop)
- [x] Fix lexer infinite loops on single `{` and `~` characters

### Phase 3: Local Recovery - Delimiters
- [x] `parseArgumentsWithRecovery()` - unclosed `(` (parser-level, with incomplete marker)
- [x] Variable recovery - unclosed `}}` (lexer emits token with incomplete flag, parser propagates)
- [x] Footnote recovery - unclosed `]` (lexer emits token with incomplete flag, parser propagates)
- [x] Link recovery - unclosed `)` (lexer emits token with incomplete flag, parser propagates)
- [x] Tests for all 4 incomplete constructs (42 recovery tests total)

### Phase 4: Local Recovery - Bodies
- [x] Handle missing directive bodies
- [x] Handle incomplete directive bodies (via parseNodeSafe in body loops)
- [x] `directiveRequiresBody()` helper
- [x] `missingBody()` DRY helper
- [x] Tests for body recovery (19 new tests)

### Phase 5: Inline Recovery
- [x] Handle unclosed `**bold`
- [x] Handle unclosed `*italic`
- [x] Handle unclosed `~~strike~~`
- [x] Handle unclosed `==highlight==`
- [x] Handle mixed inline errors (nested, with variables)
- [x] `missingFormatter()` DRY helper
- [x] Tests for inline recovery (15 new tests)

### Phase 6: Integration & Polish
- [x] Binder handles `CSTError` nodes (skips in collectLocalSymbols)
- [x] Validator handles `CSTError` nodes (skips in validateNode and validateInline)
- [x] LSP uses `incomplete` flag (completion.ts getCompletionContext)
- [x] Comprehensive test suite (parser-fuzz.test.ts - 37 fuzz tests)
- [x] Performance regression check (parser is fast, no debounce needed)
- [ ] Documentation (deferred)

---

## Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Error node or flag? | **Both** | `CSTError` for garbage, `incomplete` flag for partial-but-valid |
| Sync points? | **@, #, -, list markers** | Tokens that START constructs; DEDENT is boundary-only |
| Preserve tokens in error? | **Yes** | Needed for diagnostics and potential re-parse |
| Throw or collect? | **Collect** | Parser should never throw, return CST with diagnostics |

---

## Sync Points

Tokens that start new top-level constructs (SYNC - resume AT these):
- `DIRECTIVE` - `@name`
- `HEADER_MARKER` - `#`, `##`, etc.
- `BULLET` - `-`
- `NUMBERED` - `1.`, `a.`
- `NUMBERED_ITEM` - `@@`, `@@@`
- `FOOTNOTE_DEF` - `[^label]:`

Tokens that end current construct (BOUNDARY - stop BEFORE, consume during cleanup):
- `NEWLINE`
- `DEDENT` - ends blocks, NOT a sync point
- `EOF`

---

## Test Cases to Cover

### Phase 2: Synchronization
```ldoc
@if(x
  body here
@define foo
  more content
```
→ Should produce: `CSTError` for broken `@if`, valid `CSTDirective` for `@define`

### Phase 3: Delimiters
```ldoc
@use(myMacro
Hello {{name
```
→ Should produce: incomplete `@use`, incomplete interpolation, valid text

### Phase 4: Bodies
```ldoc
@if(condition)
@define another
  content
```
→ Should produce: incomplete `@if` (missing body), valid `@define`

### Phase 5: Inline
```ldoc
This is **bold without close
And *italic too
```
→ Should produce: paragraph with incomplete bold, incomplete italic

---

## Regressions to Watch

| Test | Expected | Notes |
|------|----------|-------|
| All existing parser tests | Pass unchanged | Core behavior preserved |
| Valid documents | Identical CST | No `incomplete` flags, no `CSTError` |
| Performance | No regression | Measure parse time for large docs |

---

## Dependencies

- **LSP**: Depends on Phase 6 completion (uses `incomplete` flag)
- **Binder**: Minor update in Phase 6 (skip `CSTError` nodes)
- **Evaluator**: No changes needed (errors filtered by binder)

---

## Reference: Industry Patterns

### TypeScript
```typescript
function createMissingNode<T>(kind: SyntaxKind): T {
  const node = createNode(kind);
  node.flags |= NodeFlags.Missing;
  return node;
}
```

### Rust Analyzer (rowan)
```rust
pub enum SyntaxKind {
    ERROR,        // Error node
    TOMBSTONE,    // Placeholder
    // ... real nodes
}
```

### Go Parser
```go
func (p *parser) syncStmt() {
    for {
        switch p.tok {
        case token.BREAK, token.CONST, token.CONTINUE, ...:
            return
        }
        p.next()
    }
}
```

---
