I reviewed `LDOC-V3-SPEC.md`, `git-journal.md`, and all `src/**/*.ts` files. Your core diagnosis is mostly right; a few fixes need tightening to avoid new debt.

**Issue 1 — Args Parsing Boundary**

- Verdict: **Modify** (direction is right, but centralize _all_ args parsing, not just parser->binder/evaluator).
- Severity: **P0** (DRY + phase leakage + duplicate diagnostics).
- Prescription:
  - Parse args once in parser and attach structured args to CST nodes:
    - `src/types/cst.ts:45` (`Directive`), `src/types/cst.ts:54` (`ListItemMarker`), `src/types/cst.ts:182` (`InlineDirective`) add parsed args payload.
    - Keep raw text (`argsRaw`) per spec §6.4 recovery (`src/parse/parser.ts:203`, `src/parse/parser.ts:340`, `src/parse/parser.ts:604`).
  - Remove re-parsing from:
    - `src/bind/binder.ts:135`
    - `src/bind/resolver.ts:69`
    - `src/evaluate/evaluator.ts:77`
    - `src/lsp/navigation.ts:94`
  - Parser should emit args diagnostics once with args span and recover to `{}` (spec §6.4).
- Keep `argsRaw`? **Yes** (required by spec §6.4; also useful for diagnostics/LSP).
- Runtime dependency edge cases? **No for v3 core**; direct expression-valued args are explicitly deferred (§19.0, §19 line ~681+).
- `$(...)` in args: treat as parse error in v3 core (single diagnostic, fallback `{}`), not deferred to runtime.
- Breaking changes:
  - CST API changes (new parsed args field, likely changed parser internals).
  - Tests asserting only `argsRaw` behavior will need updates.
- Order: do this first; it unlocks clean bind/eval refactors.

**Issue 2 — Binder Anchors/Refs/Styles**

- Verdict: **Modify** (anchors + ref validation in bind is correct; style handling in `SymbolTable.styles` is not).
- Severity: **P1** correctness + **P0** hollow/dead table concerns.
- Prescription:
  - Binder should do two-pass bind for refs:
    1. collect anchors (`@anchor`) from structural walk,
    2. validate `@ref(id: ...)` across inline directives in paragraph inlines.
  - Expand binder traversal into inlines (`src/bind/binder.ts:97` currently block-only).
  - Use `DiagnosticCode.UNDEFINED_ANCHOR` (`src/types/diagnostics.ts:57`) at bind time.
  - Remove emit-time undefined-anchor warning (`src/emit/docx/nodes.ts:569`).
- Styles in symbol table:
  - `SymbolTable.styles` is currently hollow (`src/types/symbols.ts:22`, `src/style/index.ts:138` reads it, binder never writes).
  - Recommendation: **do not invent heuristic “style extraction” from `@def`**. Either:
    1. remove `styles` map now (preferred debt cleanup), or
    2. introduce explicit style declaration syntax in spec first.
- Should evaluator mutate symbol table? **No**. Symbol table should be immutable after bind.
- Breaking changes:
  - Binder traversal and diagnostics timing changes.
  - Cross-ref failures move from emit warnings to bind diagnostics (good breaking behavior).
- Order: after Issue 1 parsed-args is in CST.

**Issue 3 — Anchor IR Cleanup**

- Verdict: **Confirm**.
- Severity: **P1** (abstraction leak causing downstream hacks).
- Prescription:
  - Add block IR `Anchor` and remove inline `Bookmark` from IR unions:
    - `src/types/document-ir.ts:322`, `src/types/document-ir.ts:345`, `src/types/document-ir.ts:363`.
  - Evaluator `@anchor` emits `Anchor` block, not synthetic paragraph (`src/evaluate/evaluator.ts:1018`).
  - Emitter handles `Anchor` in block emission (`src/emit/docx/nodes.ts:119`) and removes inline `Bookmark` case (`src/emit/docx/nodes.ts:436`).
  - Bookmark collection pass must scan `Anchor` blocks, not inline bookmarks (`src/emit/docx/index.ts:129`).
- Anchor shape `{ type: "Anchor", id: string }` is sufficient for v3.
- Inline anchors needed? **Not in current spec** (`@anchor` is structural).
- Heading anchors interaction: keep `Heading.anchor` only if Heading stays; otherwise moot.
- Breaking changes:
  - IR type union changes; tests expecting paragraph+bookmark wrapper break (`src/evaluate/layout.test.ts:164`).
- Order: after Issue 2 (bind anchors), then emitter update.

**Issue 4 — `@lua{}` Raw Body Parsing**

- Verdict: **Confirm**.
- Severity: **P1** spec violation (§7.2).
- Prescription:
  - Add raw-body support in parser, but model it as a **general mechanism** with a format discriminator; first consumer is `@lua`.
  - CST representation:
    - e.g. `Directive.body` becomes union: `StructuralBody | RawBody`.
    - `RawBody` includes `{ kind: "RawBody"; format: "lua"; text: string; loc: ... }`.
  - Parser must scan Lua chunk with balanced braces respecting Lua strings/comments (spec §7.2 note).
  - Evaluator executes `RawBody.text` directly; remove paragraph reconstruction path (`src/evaluate/evaluator.ts:937`).
- Lexer change needed?
  - Minimal robust approach: parser needs source-offset-aware scanning; that likely requires token offsets or passing source with line-index mapping.
  - If you cannot add offsets now, lexer-assisted chunk tokenization is fallback, but less clean.
- `@lua(...)` vs `@lua{...}`:
  - Keep `@lua{...}` as statements.
  - `@lua(...)` should remain invalid per contract (`src/bind/contracts.ts:72` has `hasArgs: "none"`).
- Breaking changes:
  - CST body type changes and parser internals.
  - Existing parser tests around `@lua(args){}` should fail by design (`src/pipeline/pipeline.test.ts:39`).
- Order: after Issue 1, before final binder/evaluator cleanup.

**Issue 5 — Dead Types / Orphaned Code**

- Verdict: **Confirm strongly**.
- Severity: **P0** (per your review policy: dead/YAGNI must be removed).
- Prescription:
  - Remove unused CST `Include` node/type (`src/types/cst.ts:35`, `src/types/cst.ts:156`) since parser never emits it.
  - Footnotes:
    - Remove IR types + emitter code paths for `Footnote`/`FootnoteRef` unless spec is updated first.
    - Affects `src/types/document-ir.ts:240`, `src/types/document-ir.ts:310`, `src/emit/docx/nodes.ts:139`, `src/emit/docx/index.ts:327`.
  - Heading:
    - Either remove `Heading` IR/emitter support as dead now, or add spec-backed syntax immediately.
    - I recommend **remove now** (no frontend producer, no spec syntax), avoid half-implemented surface.
- Breaking changes:
  - Public IR API shrinkage (`Heading`, `Footnote`, `FootnoteRef`, `Bookmark` if Issue 3 lands).
  - Emitter tests and type imports will need updates.
- Order: after Issue 3/4 so you don’t refactor deleted branches twice.

**Issue 6 — List Marker SOL Gating**

- Verdict: **Confirm**.
- Severity: **P1** (spec conformance + false positives).
- Prescription:
  - Enforce SOL in lexer for marker tokenization (`src/parse/lexer.ts:192`).
  - Track line-start state: allow optional leading whitespace, then recognize `@-`/`@#` only before any non-whitespace token on that line.
  - Non-SOL `@-`/`@#` should tokenize as normal directive/text sequence, not list marker.
- Minimal change: lexer-only; parser can remain unchanged.
- Edge cases:
  - Indented lists should still work.
  - Nested markers with `@@` at SOL still valid.
- Breaking changes:
  - Inputs that accidentally relied on mid-line marker parsing will change behavior.
- Order: independent; can land early with focused tests.

**Recommended PR #4 Scope**

- Include now:
  1. Args single-parse CST boundary (Issue 1),
  2. Binder anchors + bind-time ref validation (Issue 2 minus style map invention),
  3. Anchor IR cleanup (Issue 3),
  4. `@lua{}` raw body parsing (Issue 4),
  5. SOL marker gating (Issue 6),
  6. dead `Include` type removal from CST (Issue 5 partial).
- Separate immediate follow-up PR (still “debt purge”, before features):
  - Remove `Heading` and footnote backend remnants unless spec is extended first.

**Implementation Order (Passing State Each Step)**

1. Add parsed-args fields to CST + parser emission + diagnostics/recovery.
2. Migrate binder/resolver/evaluator/LSP to consume parsed args; delete redundant parse calls.
3. Add binder inline traversal + two-pass anchor/ref validation; remove emit-time undefined-anchor diagnostic.
4. Introduce `Anchor` block IR and update evaluator/emitter/bookmark collection.
5. Introduce `RawBody` for `@lua` and evaluator execution path; remove paragraph-based Lua body interpretation.
6. Enforce lexer SOL list marker gating.
7. Remove dead CST `Include`; then prune heading/footnote dead surfaces in follow-up PR.

**Risk / Blast Radius**

- Highest risk:
  - Parser/CST schema changes ripple across bind/eval/lsp/tests.
  - `@lua` raw scanning correctness (brace/string/comment edge cases).
- Medium risk:
  - Anchor diagnostic timing shift could surface more errors earlier.
  - IR union changes affect emitter/style compile-time exhaustiveness.
- Low risk:
  - SOL gating (localized lexer behavior).
- Mitigation:
  - Land in small commits per phase boundary, with parser/binder/eval/emit integration tests at each step.
  - Add regression fixtures for tricky Lua chunks (`{}` in strings/comments/long strings).
