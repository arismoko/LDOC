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

# 4. PR: Architectural Debt Purge

**Branch**: `refactor/architectural-debt`
**Plan**: `PRESCRIPTION.md` (9-step commit plan, success criteria, risk assessment)
**Audit**: `REVIEW.md` (oracle findings for 7 issues)
**Spec changes**: `LDOC-V3-SPEC.md` §15.3 (footnotes), §18 (architecture invariants), §18.2 (conformance)

Full architectural audit landed 7 issues covering every compiler phase. Evaluator modularization promoted to Step 3 so subsequent changes (anchor IR, @lua, dead code) target isolated handler files instead of repeatedly patching a 1,227-line monolith.

### Implementation order (see PRESCRIPTION.md for full details)

1. Parse args once → CST nodes
2. Remove downstream args re-parsing
3. **Evaluator modularization** (handler/registry/per-directive files)
4. Binder anchors + ref validation + remove hollow `SymbolTable.styles`
5. Anchor IR → block `Anchor`, remove inline `Bookmark`
6. `@lua` raw-body parsing (balanced brace scanner)
7. SOL list marker gating
8. Dead code purge (CST `Include`, IR `Heading`)
9. Phase boundary hardening

**Done when**: All 10 success criteria in `PRESCRIPTION.md` are met (109+ tests, 0 type errors, all architectural invariants enforced).

### Review fix rounds (post-prescription)

#### Round 1 — `1a0e845` (Codex review)
- Cross-file anchor resolution: `src/bind/resolver.ts` exposes `parsedDocuments`, binder collects anchors from included files.
- Emitter fallback: `src/emit/docx/nodes.ts` restored `ctx.bookmarks.has(anchorId)` guard in `emitCrossRef`.
- Removed dead `ArgsObject` import from `src/bind/binder.ts`.

#### Round 2 — `04f88dc` (oracle pre-review)
- Removed dead `symbols` field from `ResolveResult`/`ImportResolver`.
- Added recursive `deepFreeze` for `DefSymbol.value` in `src/types/symbols.ts`.
- Validate refs for included docs too in `src/bind/binder.ts`.
- Malformed `@anchor` emits warning instead of silent skip.
- Cross-file ref regression tests + nested def-value freeze test.

#### Round 3 — `fbc5121` (oracle pre-review)
- Removed unused CST variants from `src/types/cst.ts` (Table, TableRow, LayoutDirective, etc.).
- Added `BinderOptions` flags (`validateDirectives`, `validateRefs`) to `src/bind/binder.ts`.
- Fixed nested-include false B009 warnings in `src/evaluate/directives/block-include.ts`.
- Added tests for include-file directive validation (B020) and nested include false warnings.

#### Round 4 — pending commit (Codex review + oracle pre-review)

**Tagged union for `ParseArgsResult`** (P1 — Codex review):
- `isArgsParseError` type guard checked `"ok" in result` which false-positived on user args like `@foo(ok: false)`.
- Replaced untagged `ArgsObject | ParseArgsResult` return with proper discriminated union `ParseArgsSuccess | ParseArgsError` on `ok` field.
- Removed dead `isArgsParseError` function.

**Raw-body sugar rejection** (P1 — Codex review):
- `@lua[...]` paragraph sugar bypassed the raw parser entirely — Lua code silently treated as structural body.
- Parser now rejects `@lua[...]` with P005 warning and drops body. `@lua{...}` unchanged.
- Hoisted `getDirectiveContract(name)` above both body branches (DRY fix).

**Dead code removal** (P0):
- Removed unreachable StructuralBody fallback in `block-lua.ts` — parser always produces RawBody for `@lua{...}` and rejects `@lua[...]`.
- Non-RawBody path now emits diagnostic error for pipeline invariant violation instead of silent return.

**Prototype safety** (P1 — oracle pre-review):
- `parseJSON5Object` uses `Object.create(null)` — prevents prototype pollution / `hasOwnProperty` shadowing.
- `hasOwnProperty(keyText)` replaced with `keyText in result`.

**Diagnostic location rebasing** (P1 — oracle pre-review):
- All 3 `parseArgsToObject` callsites now pass LPAREN token location instead of directive start.
- Inner JSON5 parser column offsets rebased to source-file coordinates.
- Inner error code preserved through rebase (`result.error?.code ?? DiagnosticCode.PARSE_ERROR`).

**Bare string diagnostic codes** (P1 — discovered during fix):
- All 16 bare `'PARSE_ERROR'`/`'DUPLICATE_DEFINITION'` strings in `args.ts` replaced with `DiagnosticCode.X` constants.

**Tests**: 8 new regression tests (151 total, 346 expect() calls).

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

- **Multiline args diagnostic locations**: args error rebasing hardcodes `line: location.line` — for multiline args spanning newlines, inner diagnostics may point to the wrong line. Single-line args (the 99% case) are correct. Needs a `advanceLocation` helper that walks the source text to map offset → line:column.
- Typed include params (`SG-001`)
- Direct expression args (`SG-002`)
- Markdown emphasis sugar (`SG-004`)
- Table of contents generation
- Section-specific header/footer variants (first page, odd/even)
- Images/logo embedding API
- Watermarks and background text
- Defined-terms system (first occurrence styling)
- Exhibit/appendix packaging
- Track changes compatibility
