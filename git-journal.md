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

# 1. Dead code removal — DONE (merged to `main`)

Removed 390 lines across 5 dead files (`recovery.ts`, `highlight.ts`, `style-names.ts`, `filters.ts`, `utils.ts`). Zero consumers, zero imports.

---

# 2. PR: Type system migration — DONE (merged to `main`)

**Branch**: `refactor/remove-deprecated-cst-aliases`

Migrated deprecated v2 CST aliases (`CSTDocument`, `CSTNode`, `CSTDirective`, `CSTArgument`) across 11 files in 3 commits by dependency boundary. Removed alias exports from `src/types/cst.ts`.

---

# 3. PR: Spec correctness (fix silent bugs) — DONE (merged to `main`)

**Branch**: `fix/spec-correctness` + `fix/oracle-review-bugs`

Fixed all spec promises that failed silently — compiler accepted input, did nothing, emitted no warning. 8 items parser → evaluator → emitter:

- Escape sequences (§3.3), `@document` config wiring, `@anchor`/bookmark IR, cross-references (`@ref`), `@style(ref:)` resolution, list marker args (`start`/`continue`), legal numbering mode, Lua sandbox limits.
- Oracle review follow-up: removed dead token types (`LUA_BLOCK_OPEN`, `LIST_CONTINUATION`, `NUMBER`, `LENGTH`, `BOOLEAN`), preserved quote char in STRING tokens, removed comment `.trim()`, added EOF-close recovery for inline directives, whitespace tolerance between directive name/args/body (§5.1), diagnostic for structural-level text, inline whitespace preservation before non-delimiters.

107 tests, 0 type errors at merge.

---

# 4. PR: Anchor IR cleanup

**Branch**: `refactor/anchor-ir`

`@anchor` is modeled as an inline `Bookmark` wrapped in a synthetic paragraph — a leaky abstraction. `SymbolTable.anchors` exists but is never populated; anchor validation happens at emit-time instead of bind-time. Must fix before adding paragraph formatting (PR #5) to avoid defensive hacks around fake paragraphs.

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
- `src/evaluate/evaluator.ts`: validate `@ref(id: ...)` cross-references against binder's anchor set; emit diagnostic if target missing.
- Remove emit-phase `E003` diagnostic (redundant once bind handles it).

**Done when**: `@ref(id: "nonexistent")` produces a bind-phase diagnostic; emit phase trusts the reference index without re-validating.

---

# 5. PR: Professional output polish

**Branch**: `feat/professional-output`

Visual and formatting emission for real legal document output. Depends on PR #4 (clean anchor IR) to avoid paragraph formatting hacks around synthetic anchor wrappers.

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

### D — `fix(emit): wire document orientation (R4-3)`

Deferred from PR #3 review. `@document(orientation: "landscape")` is parsed but not wired to DOCX section properties.

**Done when**: `@document(orientation: "landscape")` produces landscape pages.

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
