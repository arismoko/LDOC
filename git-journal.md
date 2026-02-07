# Git Journal (LDOC v3)

## Planning rules

- Keep commits small and testable.
- Prefer correctness gates over feature breadth.
- Do not promote deferred sugar into core without spec updates.
- Fix semantic correctness bugs immediately; schedule DRY/YAGNI refactors separately.
- Stabilize types and remove dead code before adding new features.

---

## History (v3.0 Alpha)

- **0.1 – 3**: Prep and YAGNI cleanup
- **4 – 8**: Core syntax and parser
- **9 – 10**: Desugaring and contracts
- **11 – 12**: Binding and symbols
- **13**: Args parsing
- **14 – 15**: Lua evaluator
- **16 – 18**: DOCX emitter and lists/tables
- **19 – 21**: CLI and LSP basics
- **22**: Layout evaluation (columns, box, header/footer)
- **23**: Include resolution + params validation
- **24**: LSP directive autocompletion from contracts
- **25**: DOCX section/column emission
- **26**: OOXML assertion harness
- **27**: Evaluator + include regression fixtures
- **28**: LSP reference lookup for @def usages
- **29**: Directive suggestions and fix-it diagnostics

---

# 1. Dead code removal — straight to `main`

`chore(cleanup): remove 390 lines of dead code`

Code review found 5 files with zero consumers — never imported, never called.

| File | Lines | Why dead |
| ---- | ----- | -------- |
| `src/parse/recovery.ts` | 164 | Parser implements its own EOF-close recovery; this class is never imported |
| `src/shared/highlight.ts` | 32 | Exact duplicate of `colors.ts`, never imported |
| `src/shared/style-names.ts` | 84 | Leftover from v2 decompiler, never imported |
| `src/shared/filters.ts` | 39 | Re-exported from barrel but never consumed by any module |
| `src/evaluate/utils.ts` | 71 | All exports (`cloneNode`, `cloneNodes`, `applyScopePrefix`, `setPathValue`, `getPathValue`) never called |

**Changes**: delete all 5 files; remove `filters.ts` re-export from `src/shared/index.ts`.

**Done when**: deleted, `bun test` passes, no import errors.

---

# 2. PR: Type system migration

**Branch**: `refactor/remove-deprecated-cst-aliases`

v2→v3 migration left deprecated type aliases (`CSTDocument`, `CSTNode`, `CSTDirective`, `CSTArgument`) used across 11 files. Every new feature widens the migration surface. Three commits by dependency boundary for clean bisect.

### A — `refactor(types): migrate deprecated CST aliases in compiler core`

| File | Replacements |
| ---- | ------------ |
| `src/bind/binder.ts` | `CSTDocument` → `Document` |
| `src/bind/resolver.ts` | `CSTDocument` → `Document` |
| `src/evaluate/evaluator.ts` | `CSTDocument` → `Document`; `Inline as CSTInline` → `Inline`; `InlineDirective as CSTInlineDirective` → `InlineDirective` |
| `src/pipeline/index.ts` | `CSTDocument` → `Document` |
| `src/types/symbols.ts` | `CSTDocument` → `Document`, `CSTNode` → `Block`, `CSTArgument` → `Record<string, unknown>` |

**Done when**: no compiler-core file imports deprecated aliases; `bun test` passes.

### B — `refactor(lsp): migrate deprecated CST aliases in LSP modules`

| File | Replacements |
| ---- | ------------ |
| `src/lsp/server.ts` | `CSTDocument` → `Document`, `CSTDirective` → `Directive` |
| `src/lsp/navigation.ts` | `CSTDocument` → `Document`, `CSTNode` → `Block` |
| `src/lsp/completion.ts` | `CSTDocument` → `Document` |

**Done when**: no LSP file imports deprecated aliases; `bun test` passes.

### C — `refactor(types): remove deprecated CST alias exports`

Remove the deprecated alias block from `src/types/cst.ts` (lines 341–359: `CSTDocument`, `CSTNode`, `CSTDirective`, `CSTParagraph`, `CSTInline`, `CSTText`, `CSTArgument`) and their re-exports from `src/types/index.ts`.

**Done when**: `grep -r "CSTDocument\|CSTNode\|CSTDirective\|CSTParagraph\|CSTInline\|CSTText\|CSTArgument" src/` returns zero; `bun test` passes.

---

# 3. PR: Spec correctness (fix silent bugs)

**Branch**: `fix/spec-correctness`

Every item here is a spec promise that currently fails silently — the compiler accepts the input, does nothing, and emits no warning. Ordered parser → evaluator → emitter.

### A — `fix(lexer): implement escape sequences (§3.3)`

Spec requires `\@`, `\[`, `\]`, `\{`, `\}`, `\(`, `\)`, `\$`, `\\` in paragraph context. Lexer treats all backslashes as literal text — impossible to write literal `@` or `$` in paragraphs.

- `src/parse/lexer.ts`: in text/paragraph scanning, recognize `\X` for the 9 defined sequences; emit escaped character as TEXT token. Unknown `\X` → literal `\X` (per spec).

**Done when**: `\@` produces literal `@`; `\$` doesn't start a Lua expression.

### B — `feat(eval): wire @document config (margins, numbering mode, page size)`

`@document(margins: "1in", numbering: { mode: "legal" })` is in the spec but evaluator only reads title/author/date. Layout config is silently ignored.

- `src/evaluate/evaluator.ts`: parse `margins` via `parseLengthToTwips()`, `numbering.mode`, `pageSize`, `orientation`; store in `document.metadata`.
- `src/types/document-ir.ts`: extend metadata shape if needed.
- `src/emit/docx/index.ts`: read page layout from metadata and apply to DOCX sections.

**Done when**: `@document(margins: "1in 1in 1in 1.25in")` produces DOCX with correct margins.

### C — `fix(eval): implement @anchor directive and bookmark IR`

`@anchor(id: "...")` has a contract but evaluator silently drops it. Blocks all cross-reference functionality.

- `src/evaluate/evaluator.ts`: add `@anchor` case in `evaluateDirective()`, emit `Bookmark` IR node.
- Add evaluator test.

**Done when**: `@anchor(id: "payment")` produces a `Bookmark` node in IR and appears in DOCX.

### D — `feat(parse): add [[id]] cross-reference syntax`

Spec §15.2 defines `[[id]]` inline syntax. Not parsed at all — no token type, no parser rule.

- `src/parse/lexer.ts`: recognize `[[` in paragraph context, scan to `]]`.
- `src/parse/parser.ts`: handle `[[id]]` → `CrossRef` inline node.
- `src/types/tokens.ts`: add token type if needed.
- `src/evaluate/evaluator.ts`: evaluate `CrossRef` inline → `CrossRef` IR targeting anchor ID.

**Done when**: `[See [[payment-terms]] for details.]` parses, evaluates, and emits as DOCX internal hyperlink.

### E — `fix(eval): resolve @style(ref: ...) through @def bindings`

Spec §10.4 says `@style(ref: "h1")` resolves from `@def` bindings. Currently `ref` is never checked.

- `src/evaluate/evaluator.ts`: in `evaluateInlineDirective()` and `paragraphStyleRefFromArgs()`, check `ref`, look up in `state.defs`, extract `r`/`p` channels. Warn if `p` used inline (§10.3).

**Done when**: `@def(strong: { r: { bold: true } })` then `@style(ref: "strong"){text}` applies bold; missing ref emits diagnostic.

### F — `fix(eval): wire list marker args (start, continue)`

Spec §11.3: `@#(start: 5)` and `@#(continue: true)`. Args parsed into CST but `evaluateListRun()` ignores them.

- `src/evaluate/evaluator.ts`: read `start`/`continue` from first item's args, pass to `List` IR.
- `src/types/document-ir.ts`: add `start?`/`continue?` to `List` if absent.
- `src/emit/docx/nodes.ts`: pass `start` to DOCX numbering; handle `continue` flag.

**Done when**: `@#(start: 5)[Fifth]` starts at 5; `@#(continue: true)` continues previous numbering.

### G — `feat(emit): implement legal numbering mode`

Spec §11.2: `"legal"` numbering (`1.`, `(a)`, `(i)`, `(A)`). Only `"tiered"` exists.

- `src/emit/docx/numbering.ts`: add `createLegalLevels()` with alternating formats.
- `src/emit/docx/index.ts`: read `numberingMode` from metadata.

**Done when**: `@document(numbering: { mode: "legal" })` produces `1.`, `(a)`, `(i)` progression.

### H — `fix(eval): add Lua sandbox instruction limit and timeout`

Spec §7.4 requires limits. Infinite loop in `$(...)` or `@lua{...}` freezes the compiler.

- `src/evaluate/lua/runtime.ts`: set instruction limit via wasmoon hook; wrap calls with ~5s timeout.
- `src/evaluate/evaluator.ts`: catch timeout, produce `EXPRESSION_ERROR` diagnostic.

**Done when**: `$(while true do end)` produces a diagnostic instead of hanging.

### Review Disposition (PR #3)

All review comments across 5 Codex review rounds have been triaged. New sessions should skip re-verification and only act on items marked 🔴 or ⏭️.

| Comment | Issue | Sev | Status | Commit |
| ------- | ----- | --- | ------ | ------ |
| R1-1 | Legal numbering mode early return in `getNumberingReference()` | P1 | ✅ Fixed | `10d60de` |
| R1-2 | `emitBookmark()` returns `[]` instead of real `Bookmark` | P1 | ✅ Fixed | `10d60de` |
| R2-1 | Legal config missing when `hasOrdered` is true | P1 | ✅ Fixed | `92c30a3` |
| R2-2 | Partial margins clobber unset sides | P2 | ✅ Fixed | `92c30a3` |
| R2-3 | `[[id]]` not parsed in `@style{...}` bodies | P2 | ✅ Fixed | `92c30a3` |
| R2-4 | Empty paragraph wrapper for `@anchor` | P2 | ⏭️ Deferred | PR #5 |
| R3-1 | Unknown escape + newline corrupts line tracking | P1 | ✅ Fixed | `084c233` |
| R3-2 | `@style(ref:)` replaces `r` overrides instead of merging | P2 | ✅ Fixed | `084c233` |
| R3-3 | `[[id]]` syntax conflicts with `[` paragraph open | P1 | ✅ Fixed | `e00a620` — replaced with `@ref(id: ...)` |
| R3-4 | List start/continue not wired to DOCX emission | P1 | ✅ Fixed | `da93bb3` |
| R4-1 | Dynamic list ref when baseDef missing | P1 | ✅ Fixed | `876b8c5` |
| R4-2 | Continuation instances not scoped by nesting level | P1 | ✅ Fixed | `876b8c5` |
| R4-3 | Document orientation not wired to style/emission | P2 | ⏭️ Deferred | PR #4 |
| R5-1 | Start override applied at level 0 instead of active nesting level | P1 | ✅ Fixed | `a4f3fbf` |
| R5-2 | Default numbering defs missing during emission (baseDef lookup fails) | P1 | ✅ Fixed | `a4f3fbf` |
| R5-3 | @ref display text drops non-Text inlines (Styled, Bold, Code) | P1 | ✅ Fixed | `a4f3fbf` |

### Self-Review Findings (post-R5)

Performed comprehensive self-review + oracle code review. All findings fixed in a single commit.

| Finding | Category | Fix |
| ------- | -------- | --- |
| `PipelineError` class declared but never thrown — `tryCompile()` returns `diagnostics: []` on failure | **Bug** | Wire `PipelineError` into `parseWithDiagnostics()` and `throwOnBindErrors()`; `tryCompile` extracts `.diagnostics` |
| Block `@style(ref: ...)` never resolved through `@def` bindings | **Bug** | Extract shared `resolveStyleRef()` helper; block case now uses it |
| `@document(numbering: "legal")` string shorthand silently ignored | **Bug** | Handle string form alongside object `{mode: "legal"}` |
| Single `/` in text causes infinite lexer loop | **Bug** | Add explicit `/` handler before `scanText()`; remove `/` from break set |
| Smart-quote regex in `bookmarkSafeName` was no-op (regular quotes) | **Bug** | Use `\u201C\u201D` Unicode escapes |
| `hasBullet`/`hasDecimal` in `ensureDefaultNumberingDefs()` used structural matching — user-defined decimal list would suppress system default | **Bug** | Changed to strict ID-based checks, consistent with `hasLegal` |
| `scanNumber()` in lexer unreachable — digits hit `isAlphaNumeric` → `scanIdentifier` first | **Dead code** | Removed `scanNumber()` and its call site |
| `normalizeRefKey()` and `uniqueBookmark()` in bookmarks.ts never imported | **Dead code** | Removed both functions |
| `compileToDocument`/`compileToStyledDocument` doc comments say "Synchronous" but are async | **Doc error** | Fixed doc comments |
| Pipeline helpers DRY violation (`parseWithDiagnostics`, `throwOnBindErrors`, `buildBindOptions` duplicated) | **DRY** | Extracted 3 shared helpers used by `runPipelineTo`, `parseAndBind`, `parseAndBindWithIncludes` |
| Numbering DRY: fallback logic in both `ensureDefaultNumberingDefs` and `createNumberingConfig` | **DRY** | Removed all fallback/factory code from `createNumberingConfig`; single source of truth in `ensureDefaultNumberingDefs` |
| `numberingMode` parameter threaded through but unused | **YAGNI** | Removed from `ensureDefaultNumberingDefs` and `createNumberingConfig` signatures |

Tests: 81 pass (79 original + 2 new pipeline tests), 0 fail, 0 TypeScript errors.

### Oracle Code Review (4-layer)

Full oracle code review performed on `fix/spec-correctness` branch. All 9 findings fixed across 2 commits.

| # | Finding | Sev | Fix | Commit |
|---|---------|-----|-----|--------|
| 1 | `@style(ref:)` block-level resolution not wired | P1 | Share `resolveStyleRef()` between block and inline paths | `90cbacf` |
| 2 | Parser dispatch: giant switch duplicates can-have-body logic | P2 | DRY via `BLOCK_DIRECTIVE_SET` lookup + shared `parseDirectiveCommon()` | `90cbacf` |
| 3 | Emitter duplication: `compileToDocument`/`compileToStyledDocument` copy-pasted | P2 | Extract `buildDocument()` helper | `90cbacf` |
| 4 | `emitBookmark()` wraps in paragraph, leaking IR abstraction | P2 | Deferred to PR #5 (anchor IR cleanup) | — |
| 5 | Evaluator: `start`/`continue` exclusivity not enforced | P1 | Add diagnostic when both specified; `continue` wins | `65294e8` |
| 6 | Evaluator: `@document(margins: "1in")` 1-value shorthand not wired | P1 | Already handled, verified by test | `65294e8` |
| 7 | Numbering config: `baseDef` lookup can return `undefined` | P1 | Add null-check with early return | `65294e8` |
| 8 | `emitBookmark()` should sanitize name consistently | P2 | Uses `bookmarkSafeName()` from bookmarks.ts | `65294e8` |
| 9 | Dead code in `emit/docx/utils.ts` | P3 | Removed `buildRunProperties()` and `buildParagraphProperties()`; only `Mutable<T>` remains | `65294e8` |

### YAGNI Cleanup (post-review)

Removed 161 lines of dead code across `parser.ts` and `cst.ts`:
- **parser.ts**: 15 unused type imports, 1 dead interface (`ParseResultInternal`), 1 dead function (`advanceToken()`)
- **cst.ts**: 4 speculative "reserved for future use" types (`Anchor`, `Def`, `Style`, `DocumentConfig`), 17 unused constructor functions, 1 unused `TokenType` import

Tests: 88 pass, 0 fail, 0 TypeScript errors. Commit: `b0ac236`.

---

# 4. PR: Professional output polish

**Branch**: `feat/professional-output`

Visual and formatting emission for real legal document output.

### A — `fix(emit): add blockquote/box visual styling`

`@box{...}` maps to `Blockquote` IR but emits with no visual distinction — no border, no indent.

- `src/emit/docx/nodes.ts`: in `emitBlockquote()`, apply left border + indentation.

**Done when**: `@box{ [Notice text.] }` renders with visible left border and indent in Word.

### B — `feat(emit): paragraph formatting controls`

Legal docs need hanging indents, tab stops, widow/orphan, keep-with-next. Available in `ComputedStyle` but not all wired through emission.

- `src/emit/docx/styles.ts`: audit and complete `toParagraphOptions()` — indent (left, right, hanging, firstLine), tabStops, widowControl, keepNext, keepLines, spacing (before, after, line).
- Add tests for each property.

**Done when**: `@style(p: { indent: { left: "0.5in", hanging: "0.25in" } })[text]` renders correctly; `keepNext` works.

### C — `feat(emit): table layout controls`

Legal schedules need header row repeat, cell padding, and no-split rows.

- `src/emit/docx/tables.ts`: support `@table(headerRows: 1)`, `@table(cellPadding: "0.05in")`, `@row(cantSplit: true)`.
- `src/bind/contracts.ts`: validate new args.

**Done when**: header rows repeat on page breaks; `cantSplit` rows don't break.

---

# 5. PR: Anchor IR cleanup

**Branch**: `refactor/anchor-ir`

Review of PR #3 revealed that `@anchor` is modeled as an inline `Bookmark` wrapped in a synthetic paragraph — a leaky abstraction. The 80% fix (pre-emit reference index, canonical sanitizer, unified registration) ships in PR #3. This PR completes the architectural cleanup.

### A — `refactor(types): promote Bookmark inline to Anchor block IR`

`Bookmark` is currently an `Inline` node in `src/types/document-ir.ts`. Anchors are structural targets, not text styling — they should be block-level.

- `src/types/document-ir.ts`: add `Anchor` to `Block` union (`{ type: "Anchor", id: string }`); remove `Bookmark` from `Inline` union.
- `src/evaluate/evaluator.ts`: `@anchor` case emits `Anchor` block directly instead of `Paragraph` + inline `Bookmark`.
- `src/emit/docx/nodes.ts`: add `case "Anchor"` in `emitBlock()`; remove `case "Bookmark"` from `emitInline()`.
- Update tests in `src/evaluate/layout.test.ts` (anchor assertions check `Anchor` block, not wrapper paragraph).

**Done when**: `@anchor(id: "x")` produces an `Anchor` block in IR; no synthetic paragraph wrapper; OOXML output unchanged.

### B — `refactor(bind): collect anchor targets in bind phase`

`SymbolTable.anchors` exists (`src/types/symbols.ts`) but is never populated. Move undefined-anchor diagnostics earlier.

- `src/bind/binder.ts`: collect anchor IDs from `@anchor` directives and `Heading.anchor` fields during bind pass.
- `src/evaluate/evaluator.ts`: validate `[[id]]` cross-references against binder's anchor set; emit diagnostic if target missing.
- Remove emit-phase `E003` diagnostic (redundant once bind handles it).

**Done when**: `[[nonexistent]]` produces a bind-phase diagnostic; emit phase trusts the reference index without re-validating.

---

## Deferred (not in v3 core path)

- Typed include params (`SG-001`)
- Direct expression args (`SG-002`)
- Markdown emphasis sugar (`SG-004`)
- `@lua{...}` raw-chunk body parsing — Lua-aware balanced-brace scanning that respects Lua strings/comments (Spec §7.2). Current: `@lua{...}` goes through generic structural body parser, which works for simple cases but mangles Lua code containing `}` in strings or `--` comments. Needs dedicated body parser.
- List marker SOL gating — Spec §11.1 says markers SHOULD be recognized only at start-of-line; currently `@-`/`@#` are recognized anywhere in structural context
- Table of contents generation
- Section-specific header/footer variants (first page, odd/even)
- Images/logo embedding API
- Watermarks and background text
- Defined-terms system (first occurrence styling)
- Exhibit/appendix packaging
- Track changes compatibility
