# LSP Port Journal

Track progress, decisions, and deferred items during the LSP port.

## Format

```
### [DATE] - Phase N: Description

**Item**: What was done/deferred
**Status**: Complete / In Progress / Deferred / Blocked
**Notes**: Additional context
```

---

### 2026-02-05 - Phase 5: Cross-file Support COMPLETE

**Item**: Cross-file import resolution for LSP
**Status**: Complete
**Notes**:
- Updated `src/bind/resolver.ts`:
  - `collectSymbols()` now sets `source` field on all symbol locations
  - All collect* methods pass filePath to tag symbols with their source file
- Updated `src/lsp/server.ts`:
  - Added `hasImports()` to detect @import directives
  - Uses async `bind()` with `loadFile` when imports are present
  - Converts document URIs to file paths for import resolution
- Updated `src/lsp/navigation.ts`:
  - Added `getUri()` helper using vscode-uri
  - `getDefinition()` returns cross-file Location when symbol defined in imported file
  - `getReferences()` also supports cross-file locations
- Added `vscode-uri` dependency for proper URI handling

**Tests Added**: `tests/lsp/imports.test.ts` - 7 tests:
- Imports macros/variables/anchors/styles from external file
- Symbol definedAt.source points to correct file
- Cycle detection works
- Go-to-definition returns cross-file Location
- Missing import files produce errors

**Fixtures Created**: `tests/fixtures/imports/`
- `lib.ldoc` - Shared definitions (macro, style, variable, anchor)
- `main.ldoc` - Main file with @import
- `circular-a.ldoc`, `circular-b.ldoc` - Cycle detection test

**Verification**:
- 387 tests pass (7 new import tests)
- Typecheck passes

---

### 2026-02-05 - Phase 4: Server Integration COMPLETE

**Item**: Main LSP server with document management
**Status**: Complete
**Notes**:
- Created `src/lsp/server.ts` with:
  - `startServer()` - Main entry point, configures stdio/socket transport
  - `DocumentCache` - In-memory document storage with version tracking
  - Full LSP capability registration (completion, definition, references, diagnostics)
  - Event handlers for didOpen, didChange, didClose, completion, definition, references
  - Async document validation with on-type diagnostics
- Updated `src/lsp/index.ts` with server exports

**Features**:
- Document change tracking with versioned cache
- Parse-and-bind on every change (fast enough, no debounce needed)
- Error-tolerant parsing means diagnostics show even with broken syntax
- CST-based completion using `incomplete` markers from error recovery

**Verification**:
- 380+ tests pass
- Typecheck passes
- Server exports functional

---

### 2026-02-05 - Phase 3: Completion COMPLETE

**Item**: CST-based completion with text fallback
**Status**: Complete
**Notes**:
- Created `src/lsp/completion.ts` with:
  - `getCompletionContext()` - CST-first context detection using `incomplete` markers
  - `getCompletionItems()` - Completion item generation for all contexts
  - `contextFromIncompleteNode()` - Uses MissingElement to detect what's needed
  - `detectFromText()` - Text-based fallback for edge cases
- Completion contexts supported:
  - `directive` - After `@`
  - `macro_name` - Inside `@use()`
  - `macro_param` - Macro parameter names
  - `variable` - Inside `{{ }}`
  - `variable_filter` - After `|` in variable
  - `cross_ref` - Inside `[[ ]]`
  - `footnote_ref` - After `[^`
  - `anchor` - For `@ref()` directive
- Created `tests/lsp/completion.test.ts` - 23 tests
- Updated `src/lsp/index.ts` with completion exports

**Architecture Decision**:
- Oracle recommended CST-first approach since we invested in error-tolerant parsing
- Uses `incomplete` flag and `MissingElement` as primary completion signal
- Text-based fallback only for edge cases (cursor in whitespace, first char of delimiter)

**Verification**:
- 343 total tests pass (1 skipped)
- 23 completion tests
- Typecheck passes

---

### 2026-02-05 - Phase 2: Navigation COMPLETE

**Item**: Go-to-definition, find-references, and CST navigation
**Status**: Complete
**Notes**:
- Created `src/lsp/navigation.ts` with:
  - `findNodeAtPosition()` - Walk CST to find deepest node at position
  - `getDefinition()` - Go-to-definition for macros, anchors, footnotes, variables
  - `getReferences()` - Find all usages of a symbol
  - `NavigationContext` type for bundling CST + symbols + URI
- Updated `src/lsp/index.ts` with navigation exports

**Parser fixes required for navigation**:
- Fixed 9 inline node types to use token end positions (Variable, FootnoteRef, CrossRef, Link, Image, Code, HardBreak, DefinedTerm, Blank)
- Fixed directive end position calculation (was using token start instead of end)
- Changed `positionInLocation()` to half-open interval [start, end) for correct sibling boundary handling

**Tests**:
- Created `tests/lsp/navigation.test.ts` - 21 tests (18 pass, 3 skipped)
- 3 tests skipped: CrossRef `[[target]]` syntax not recognized by lexer (pre-existing limitation)

**Verification**:
- 317 total tests pass (4 skipped)
- 56 LSP tests (53 pass, 3 skip)
- Typecheck passes

---

## Entries

### 2026-02-05 - Planning Complete

**Item**: Oracle review and planning
**Status**: Complete
**Notes**: 
- Oracle analyzed old LSP (~1560 lines) vs new architecture
- Recommended deleting indexer.ts and workspace.ts (binder provides everything)
- Estimated ~840 lines for new implementation (46% reduction)
- Created LSP.md with 5-phase plan

---

### 2026-02-05 - Architecture Decision: CST-Based Completions

**Item**: Completion context detection approach
**Status**: Decision made
**Notes**:
- Oracle initially recommended text-based (regex) detection
- User requested industry-standard approach
- Decision: **CST-based with error-tolerant parser**
- Created ERROR-RECOVERY.md for parser enhancement
- LSP Phase 3 now depends on error recovery Phase 3

---

### 2026-02-05 - Phase 1: Foundation COMPLETE

**Item**: Position conversion and diagnostic mapping utilities
**Status**: Complete
**Notes**:
- Created `src/lsp/position.ts` with:
  - `sourceLocationToRange()` - SourceLocation (1-based line) → LSP Range (0-based)
  - `positionInLocation()` - Check if LSP Position is within SourceLocation
  - `positionToOffset()` - LSP Position → character offset
  - `offsetToPosition()` - Character offset → LSP Position
- Created `src/lsp/diagnostics.ts` with:
  - `toLspDiagnostic()` - Single diagnostic conversion
  - `toLspDiagnostics()` - Array conversion
- Created `src/lsp/index.ts` - Public exports
- Created `tests/lsp/position.test.ts` - 26 tests for position utilities
- Created `tests/lsp/diagnostics.test.ts` - 8 tests for diagnostic conversion

**Also completed as prerequisite**:
- Binder handles `CSTError` nodes (skips in collectLocalSymbols)
- Validator handles `CSTError` nodes (skips in validateNode and validateInline)

**Verification**:
- 34 LSP tests pass
- 298 total tests pass (1 skipped)
- Typecheck passes

---

## Dependencies

| LSP Phase | Depends On | Reason |
|-----------|------------|--------|
| Phase 3 (Completion) | Error Recovery Phase 3 | Needs `incomplete` flag on partial nodes |
| Phase 4 (Server) | Error Recovery Phase 6 | Binder must handle `CSTError` nodes |

---

## Deferred Items

| Item | From Phase | To Phase | Reason | Severity |
|------|------------|----------|--------|----------|
| @foreach loop variable completion | Phase 3 | Post-LSP | Binder doesn't track loop vars | Nice-to-have |
| Version-based caching | Phase 4 | Post-LSP | Parser is fast enough | Nice-to-have |
| Hover documentation | - | Post-LSP | Not in old LSP either | Nice-to-have |

---

## Questions / Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| Keep text-based context detection? | **Yes** | Works on raw text, no CST parsing needed, simpler |
| Separate references.ts file? | **No** | Merge into navigation.ts, only 88 lines |
| Sync or async for imports? | **Async when needed** | Use sync parseAndBind() normally, async bind() only when @import detected |
| Position coordinate system? | **Convert at boundaries** | SourceLocation is 1-based line, 0-based col; LSP is 0-based line, 0-based char |

---

## Phase Progress

### Phase 1: Foundation
- [x] position.ts - Position conversion utilities
- [x] diagnostics.ts - Diagnostic conversion
- [x] index.ts - Public exports
- [x] Unit tests (34 tests passing)

### Phase 2: Navigation
- [x] navigation.ts - Go-to-definition + find-references
- [x] CST node walking utilities (findNodeAtPosition, getWalkableChildren)
- [x] Integration tests (21 tests, 3 skipped for lexer limitation)
- [x] Parser fixes for inline node end positions
- [x] Position interval semantics (half-open [start, end))

### Parser Fixes (as part of Phase 2):
- Fixed inline nodes to use token end positions (Variable, FootnoteRef, CrossRef, Link, Image, etc.)
- Fixed directive end position calculation
- Changed positionInLocation to half-open interval for correct boundary handling

### Phase 3: Completion
- [x] completion.ts - CST-based context detection
- [x] completion.ts - Completion item generation
- [x] Text-based fallback for edge cases
- [x] Tests for all contexts (23 tests)

### Phase 4: Server Integration
- [x] server.ts - Main server
- [x] index.ts - Exports
- [ ] E2E tests (deferred - manual testing recommended first)

### Phase 5: Cross-file Support
- [x] Async validation with ImportResolver
- [x] Cross-file go-to-definition
- [x] Multi-file tests (7 tests)

---

## Old File Reference

For reference, the old implementation locations:

| File | Path | Lines | Key Functions |
|------|------|-------|---------------|
| server.ts | src.bak/lsp/server.ts | 514 | startServer, validateDocument |
| completion.ts | src.bak/lsp/completion.ts | 609 | detectCompletionContext, completeForContext |
| indexer.ts | src.bak/lsp/indexer.ts | 182 | DocumentIndex, indexDocument |
| references.ts | src.bak/lsp/references.ts | 88 | findReferences, findDefinition |
| workspace.ts | src.bak/lsp/workspace.ts | 167 | WorkspaceIndex, resolveImport |

---

## Testing Notes

### Manual Testing Checklist

- [ ] VSCode: Install extension, open .ldoc file
- [ ] Neovim: Configure LSP client, open .ldoc file
- [ ] Test completion after `@`
- [ ] Test completion after `@use(`
- [ ] Test completion inside `{{}}`
- [ ] Test go-to-definition on `@use(macroName)`
- [ ] Test find-references on `@define macroName`
- [ ] Test diagnostics appear for undefined macro
- [ ] Test cross-file @import resolution

---

## Regressions Log

Track any regressions from old LSP behavior.

| Feature | Old Behavior | New Behavior | Status |
|---------|--------------|--------------|--------|
| (to be filled) | | | |

---
