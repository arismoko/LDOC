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


