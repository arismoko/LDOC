# Deferred Work Journal

Track items deferred to later phases during the rewrite.

## Format

```
### [DATE] - Phase N: Description

**Item**: What was deferred
**From**: Which phase encountered this
**To**: Which phase will handle it
**Reason**: Why we're deferring
**Severity**: Critical / Important / Nice-to-have
**Notes**: Any additional context
```

---

## Entries

### 2026-02-05 - Initial Setup

**Item**: LSP integration
**From**: Phase 1 (Parse)
**To**: Phase 6 (Integration)
**Reason**: LSP needs the full pipeline; focus on core first
**Severity**: Important
**Notes**: Port from src.bak/lsp/ once pipeline is stable

---

**Item**: Formatter
**From**: Phase 1 (Parse)
**To**: Phase 6 (Integration)
**Reason**: Formatter needs CST; implement after CST is stable
**Severity**: Nice-to-have
**Notes**: Port from src.bak/formatter/

---

**Item**: Decompiler integration
**From**: Phase 1 (Parse)
**To**: Phase 6 (Integration)
**Reason**: Decompiler is mostly independent; wire up at end
**Severity**: Important
**Notes**: src.bak/decompiler/ is already clean from recent refactor

---

**Item**: Fidelity tests
**From**: Phase 1 (Parse)
**To**: Phase 5 (Emit)
**Reason**: Need full pipeline to run DOCX roundtrip tests
**Severity**: Critical
**Notes**: These are the true acceptance tests

---

## Regressions Log

Track known regressions during rewrite.

| Phase | Regression | Temporary? | Resolution Phase | Notes |
|-------|-----------|------------|------------------|-------|
| (to be filled) | | | | |

---

## Questions / Decisions

Track architectural decisions and open questions.

| Question | Decision | Rationale |
|----------|----------|-----------|
| CST vs AST - do we need both? | **CST only for Phase 1** | CST is the parser output. Bound AST is created in Phase 2 by linking symbols. No separate "AST" type needed - binding annotates the CST. |
| Should styles be bound in Phase 2? | **Yes, partially** | Style definitions are collected in Phase 2. Resolution to concrete values happens in Phase 4. |
| Expression language complexity? | **Defer complex features** | Start with simple variable substitution. Add filters/conditions incrementally in Phase 3. |
| Token types - unified or split? | **Unified** | Single TokenType enum covers all tokens. Parser determines semantics based on context. |
| Emphasis markers - paired or not? | **Single token type** | Lexer emits BOLD_START for all **. Parser determines if it's opening or closing based on context. |

---

## Phase 1 Progress

### 2026-02-05 - Phase 1 Implementation

**Completed:**
1. Core types defined in `src/types/`:
   - `source-location.ts` - Source tracking
   - `diagnostics.ts` - Error/warning system with codes
   - `tokens.ts` - Token types for lexer
   - `cst.ts` - Concrete Syntax Tree types
   - `document-ir.ts` - Document IR (the key abstraction!)
   - `symbols.ts` - Symbol table types
   - `styled.ts` - Styled document types

2. Shared utilities ported to `src/shared/`:
   - `units.ts` - Twips, points, inches conversion
   - `colors.ts` - Highlight colors
   - `filters.ts` - Text filters
   - `bookmarks.ts` - Bookmark utilities
   - `numbering.ts` - List numbering

3. Lexer implemented in `src/parse/lexer.ts`:
   - Indentation-based INDENT/DEDENT
   - Directives, headers, lists, inline formatting
   - 17 tests passing

4. Parser implemented in `src/parse/parser.ts`:
   - Recursive descent
   - Produces CST
   - 15 tests passing (32 total with lexer)

**Deferred to later phases:**
- Table parsing (complex, defer to Phase 1.5 or later)
- Image parsing (needs full inline handling)
- Full argument parsing (LENGTH, BOOLEAN literals)
- Link parsing (need [text](url) handling)
- Inline code with content

---

### 2026-02-05 - Phase 1 Quick Fixes (Post-Oracle Review)

**Completed:**
1. Renamed `*_START`/`*_END` tokens → `*_MARKER` (single token for open/close)
   - Removed dead `BOLD_END`, `ITALIC_END`, `STRIKE_END`, `CODE_END`, `HIGHLIGHT_END`
2. Fixed tab width: changed from 2 spaces to 4 spaces
3. Added mixed tabs/spaces detection with diagnostic
4. Excluded `src.bak/`, `tests.bak/`, `fidelity/` from tsconfig to clean up typecheck
5. Added 2 new tests for tab handling (34 tests total)

---

### 2026-02-05 - Phase 1.5: Link and Table Parsing

**Completed:**
1. **Link parsing implemented:**
   - Added `LINK` token type (replaces `LINK_START`/`LINK_END`/`LINK_URL`)
   - Added `lookaheadIsLink()` to detect `[text](url)` pattern
   - Added `scanLink()` to tokenize full link
   - Parser creates `CSTLink` nodes with `text` and `url`

2. **Table parsing verified:**
   - Tables use `@table`, `@row`, `@cell` directives (already working)
   - Parser handles these as generic `CSTDirective` nodes
   - Semantic interpretation happens in later phases (BIND/EVALUATE)
   - This is cleaner separation of concerns - parser stays "dumb"

3. **Image parsing already working:**
   - `IMAGE` token already captures `alt|src`
   - Parser creates `CSTImage` nodes

4. **Tests added:**
   - 3 link lexer tests
   - 5 parser tests for links, images, tables
   - Total: 42 tests passing

---

## Oracle Review: Phase 1 (2026-02-05)

**Overall Verdict:** Solid work. Architecture is correct. Issues are refinements, not fundamental problems.

### Scores

| Criterion      | Score | Notes                                        |
| -------------- | ----- | -------------------------------------------- |
| Architecture   | 9/10  | Multi-phase is correct, CST/IR split is good |
| Type Design    | 7/10  | Good bones, some redundancies                |
| Implementation | 6/10  | Works but has gaps                           |
| Error Handling | 5/10  | Structure good, recovery missing             |
| Completeness   | 6/10  | Tables, links incomplete                     |

### Validation

> "This follows the classic multi-pass compiler architecture used by TypeScript, Roslyn, and Rust. You're on par structurally."

### Priority Fixes Identified

| Issue                                  | Severity | Phase to Fix | Status      |
| -------------------------------------- | -------- | ------------ | ----------- |
| Dead `*_END` token types               | Low      | Phase 1.5    | ✅ Fixed    |
| Image token pipe-encoding              | Medium   | Phase 1.5    | ✅ Fixed    |
| `Bold`/`Italic` vs `Styled` redundancy | Medium   | Phase 4      | Pending     |
| `loc` optional on IR nodes             | Medium   | Phase 3      | Pending     |
| No table parsing                       | High     | Phase 1.5    | ✅ Fixed    |
| No link parsing                        | High     | Phase 1.5    | ✅ Fixed    |
| Mixed tabs/spaces handling             | Low      | Phase 1.5    | ✅ Fixed    |
| Tab = 2 spaces hardcoded               | Low      | Phase 1.5    | ✅ Fixed    |

### Red Flags to Address

1. **Emphasis tokens** - `BOLD_START`/`BOLD_END` confusion. Rename to `BOLD_MARKER` or remove `*_END`.
2. **Image token** - Uses `alt|src` pipe encoding. Fragile if alt contains `|`.
3. **Links incomplete** - `LINK_START` emitted but never handled in parser.
4. **No error recovery** - One parse error cascades into many.

### Recommendations for Future Phases

1. **Unified node factories** - Centralize location calculation
2. **Trivia handling** - Preserve comments/whitespace for formatter
3. **Pratt parser** - For complex expressions if needed
4. **Scope chain** - If nested `@define` is supported

### Oracle's Conclusion

> "The issues I've flagged are refinements, not fundamental problems. Your architecture will scale. **Ship Phase 2.**"


