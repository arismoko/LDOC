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

# 6. PR: Footnotes end-to-end (spec parity)

**Branch**: `feat/footnotes-core`

Close the remaining v3 core gap for §15.3. The backend surface exists (`Footnote`/`FootnoteRef` IR + DOCX emit), but the language surface is not wired — `@footnote` has no contract, no handler, no LSP completion. Implement structural + inline footnotes with diagnostics/recovery and OOXML coverage.

### A — `feat(bind): add @footnote directive contract and validation wiring`

`@footnote` must be recognized and validated like other core directives.

- `src/bind/contracts.ts`: add `footnote` contract (structural + inline; body required; args: label).
- `src/lsp/completion.ts`: add footnote completion detail/snippet.

**Done when**: `@footnote{...}` no longer emits unknown-directive diagnostics, and completion suggests `@footnote`.

### B — `feat(evaluate): implement block and inline footnote handlers`

Wire runtime behavior for both forms per §15.3.

- Add `block-footnote.ts` and `inline-footnote.ts` handlers; register in `src/evaluate/registry.ts`.
- Structural form (`@footnote(label: "x"){ ... }`) evaluates to footnote content; inline form (`@footnote[...]`) inserts `FootnoteRef` and registers body.
- Missing-body inline form emits diagnostic and recovers.

**Done when**: `[Text@footnote{Note}.]` produces `FootnoteRef` + footnote content in IR.

### C — `fix(emit): finalize DOCX footnote emission and diagnostics consistency`

Ensure collected footnotes are emitted deterministically.

- `src/emit/docx/nodes.ts` and `src/emit/docx/index.ts`: verify registration/order/id assignment.
- Standardize diagnostic codes for undefined footnotes.

**Done when**: generated DOCX contains valid `footnotes.xml` entries with matching in-text references.

### D — `test(pipeline): footnote spec-level coverage`

- `src/evaluate/layout.test.ts`: structural form, inline form, sugar form, missing body recovery.
- `src/emit/docx/ooxml-harness.test.ts`: assert `w:footnoteReference` + footnote bodies in OOXML.

**Done when**: tests prove §15.3 behavior; no silent footnote loss.

---

## Deferred (not in v3 core path)

- Typed include params (`SG-001`, partial: arity validation shipped in PR #4; type annotations/coercion deferred)
- Direct expression args (`SG-002`)
- Markdown emphasis sugar (`SG-004`)
- Table of contents generation
- Section-specific header/footer variants (first page, odd/even)
- Images/logo embedding API
- Watermarks and background text
- Defined-terms system (first occurrence styling)
- Exhibit/appendix packaging
- Track changes compatibility
