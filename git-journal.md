# Git Journal (LDOC v3)

## Planning rules

- Keep commits small and testable.
- Prefer correctness gates over feature breadth.
- Do not promote deferred sugar into core without spec updates.
- Fix semantic correctness bugs immediately; schedule DRY/YAGNI refactors separately.
- Before major feature expansion, stabilize touched types and remove dead code in the affected subsystem.

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
- **30**: Dead code removal
- **31**: Type system migration
- **32**: Spec correctness fixes
- **33**: Architectural debt purge

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

# 4. PR: Architectural Debt Purge — DONE (merged to `main`)

**Branch**: `refactor/architectural-debt` — 20 commits, 6 review rounds (Codex + oracle)
**Plan**: `PRESCRIPTION.md` | **Audit**: `REVIEW.md` | **Spec**: `LDOC-V3-SPEC.md` §15.3, §18, §18.2

Full architectural audit covering every compiler phase. Evaluator split from 1,227-line monolith into per-directive handlers. 9 prescription steps + 6 review fix rounds.

### What changed

**Parse phase**:
- Args parsed once into CST nodes; downstream re-parsing removed.
- `@lua{...}` raw-body via balanced brace scanner; `@lua[...]` sugar rejected (P005).
- SOL list marker gating; mid-line stacked `@@` preserved as text.
- Raw-body token sync uses precomputed line-start offsets (linear).
- Tagged union for `ParseArgsResult` (fixes `@foo(ok: false)` false-positive).
- Diagnostic locations rebased to source coordinates for args spans.

**Bind phase**:
- `@anchor`/`@ref` validation with cross-file resolution via `parsedDocuments`.
- `@params` arity validation at bind time via `includeEdges` (§16).
- Duplicate anchor detection per include site (not per unique file).
- `BinderOptions` flags for selective validation.
- Symbol values deep-frozen at bind boundary; runtime defs cloned during evaluate execution (§18.1.1).
- Shared helpers in `src/shared/include-params.ts` (DRY with evaluator).

**Evaluate phase**:
- Evaluator modularized into handler registry + per-directive files.

**IR / Types**:
- Anchors modeled as block `Anchor` nodes; inline `Bookmark` removed.
- Dead CST surfaces removed (Table, TableRow, LayoutDirective, Include, IR Heading).
- Dead style-cycle branch and `STYLE_CYCLE` diagnostic removed.
- `Object.create(null)` in args parser (prototype safety).
- All bare diagnostic code strings replaced with `DiagnosticCode.X` constants.

**Phase boundaries**: Hardened parse → bind → evaluate contracts. Dead code across all phases purged.

**Final stats**: 162 tests, 374 expect() calls, 0 type errors.

---

# 5. PR: Professional output polish — DONE (merged to `main`)

**Branch**: `feat/professional-output` — 7 commits, 4 review rounds (Oracle + Codex)

Visual and formatting emission for real legal document output. Enabled by PR #4's anchor IR cleanup.

- Wired `@document(orientation: "landscape")` to DOCX section properties with portrait-normalization.
- Completed `toParagraphOptions()` — indent, spacing, border, keep flags, shading, highlight.
- Split Box from Blockquote IR; `@blockquote` directive with left-border indent; `@box` as single-cell bordered table.
- Table layout controls: `headerRows`, `cellPadding`, `cantSplit`, horizontal/vertical merge markers (`>`, `^`).
- Full diagnostic coverage: E010–E018 for table validation, type mismatches, invalid merge markers.
- Vertical merge chain propagation fix for 3+ row spans.

**Final stats**: 182 tests, 411 expect() calls, 0 type errors.

---

# 6. PR: Footnotes end-to-end (spec parity) — DONE (merged to `main`)

**Branch**: `feat/footnotes-core` — merged via PR #6

Closed §15.3 end-to-end:

- Added `@footnote` directive contract + LSP completion.
- Implemented structural and inline footnote handlers with deferred registration.
- Stabilized DOCX footnote emission (ordering, include-boundary ordering, non-paragraph recovery diagnostics).
- Added IR-level and OOXML-level regression coverage.

**Final stats at merge**: 192 tests, 463 expect() calls, 0 type errors.

---

# 7. PR: Args-first deferred tranche (header/footer variants + typed include params)

**Branch**: `feat/args-first-deferred-tranche-1`

Apply an args-first rule to deferred items: extend existing directives instead of creating new directive names. Scope this PR to two high-ROI deferred features with tight tests.

### A — `spec: formalize args-first surfaces for this tranche`

- `LDOC-V3-SPEC.md`: define
  - `@header(variant: "default" | "first" | "even")`
  - `@footer(variant: "default" | "first" | "even")`
  - `@params(types: { key: "string|number|boolean|object|array[?]" })`
- `SUGAR_BACKLOG.md`: mark `SG-001` active for this PR.

**Done when**: spec and backlog clearly define accepted args, fallback behavior, and diagnostics for invalid values/types.

### B — `feat(evaluate+emit): wire header/footer variant args`

- `src/bind/contracts.ts`: allow `variant` arg on `@header`/`@footer`.
- `src/evaluate/directives/block-header-footer.ts`: route header/footer body to metadata slot (`default`/`first`/`even`) from `variant`.
- `src/emit/docx/index.ts` and `src/emit/docx/sections.ts`: read and emit all configured slots (not only `default`).

**Done when**: variant-specific header/footer content is emitted to the correct DOCX references, with diagnostics for invalid `variant` or duplicate slot overwrites.

### C — `feat(bind): enforce typed include params contracts (no coercion)`

- `src/bind/contracts.ts`: permit `types` on `@params`.
- `src/shared/include-params.ts` + binder/validator wiring: validate include callsite args against child `@params(types: ...)` declarations.
- `src/types/diagnostics.ts`: add explicit codes for malformed type literals and include arg type mismatch.

**Done when**: include arg type mismatches produce source-located diagnostics; existing untyped `@params(names: [...])` behavior remains unchanged.

### D — `test: add focused regression coverage`

- `src/evaluate/layout.test.ts` + `src/emit/docx/ooxml-harness.test.ts`: default/first/even header/footer variant behavior.
- `src/evaluate/include.test.ts` + binder tests: typed include params happy/mismatch/malformed cases.

**Done when**: all new argument surfaces have positive + negative tests and no silent fallback behavior.

**Explicit non-goals for PR #7**

- No new directives for these capabilities (`@headerFirst`, `@paramType`, etc.).
- No direct expression-valued args (`SG-002`) and no runtime coercion/casting.
- No markdown sugar (`SG-003`/`SG-004`/`SG-005`) and no control-flow directives (`@if`, `@for`).

---

## Deferred (not in v3 core path)

- Typed include params (`SG-001`, partial: arity validation shipped in PR #4; type annotations now scheduled in PR #7)
- Direct expression args (`SG-002`)
- Markdown emphasis sugar (`SG-004`)
- Table of contents generation
- Section-specific header/footer variants (first/even via `variant` arg now scheduled in PR #7)
- Images/logo embedding API
- Watermarks and background text
- Defined-terms system (first occurrence styling)
- Exhibit/appendix packaging
- Track changes compatibility
