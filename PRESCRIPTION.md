# PR #4 Prescription: Architectural Debt Purge

## Scope Statement

### In scope (must land in PR #4)

1. **Issue 1 (P0): Parse args once in Parser** and store structured args on CST nodes (`Directive`, `ListItemMarker`, `InlineDirective`) while keeping `argsRaw`.
2. **Issue 2 (P0/P1): Binder anchor/ref correctness**: populate `SymbolTable.anchors`, validate `@ref(id: ...)` in bind phase (including inline traversal), and remove emit-time undefined-anchor validation.
3. **Issue 3 (P1): Anchor IR cleanup**: add block `Anchor`, remove inline `Bookmark` from IR, and update evaluator/emitter accordingly.
4. **Issue 4 (P1): `@lua` raw-body parsing** with balanced brace scanning that respects Lua strings/comments.
5. **Issue 5 (P0/P1): Dead code purge**:
   - remove dead CST `Include` type,
   - remove dead `Heading` IR + emitter support,
   - keep Footnote/FootnoteRef backend paths (spec now includes `@footnote`, implementation deferred).
6. **Issue 6 (P1): SOL list marker gating** in lexer per spec.
7. **Issue 7 (P1): Evaluator modularization** into handler/registry architecture.
8. **Architecture rules enforcement** from spec §18: immutable SymbolTable after bind, two-table model, strict phase boundaries, and parse-once args boundary.

### Explicitly out of scope

1. Implementing full `@footnote` parser/evaluator behavior in this PR (spec updated now; runtime implementation can be follow-up).
2. Introducing new style declaration syntax or replacing removed `SymbolTable.styles` with a new design.
3. Adding `@heading` directive or any heading syntax; heading functionality remains style-driven via `@style(p: { use: "Heading1" })`.
4. Any new language sugar/features not required to close the seven audited issues.

---

## Implementation Order (one commit per step, tests passing after each)

> **Ordering rationale**: Evaluator modularization (Step 3) is promoted early because
> Steps 4-8 all touch evaluator logic. By splitting the monolith first, subsequent
> changes target isolated handler files (`directives/anchor.ts`, `directives/lua.ts`, etc.)
> instead of repeatedly patching a 1,200-line switch statement that's about to be dismantled.

## 1) Parse args once and attach structured args to CST

- **Commit message**: `feat(parse): parse directive args into CST nodes`
- **Files to modify**:
  - `src/types/cst.ts` (around current `Directive`/`ListItemMarker`/`InlineDirective` definitions)
  - `src/parse/parser.ts` (current args capture at `parseDirective`, `parseListItemMarker`, `parseInlineDirective`)
  - `src/shared/args.ts` (only if needed for parser-facing diagnostics shape)
- **Changes**:
  - Add `args?: ArgsObject` to CST nodes that currently hold `argsRaw`.
  - Parse args in parser once from `argsRaw` (spec §6.4 recovery: diagnostic + fallback `{}` + preserve raw text).
  - Ensure parser emits args diagnostics exactly once with arg span location.
  - `$(...)` inside args text MUST be treated as a parse error in v3 core (single diagnostic, fallback `{}`).
- **Test impact**:
  - Update parser/pipeline expectations to assert parsed args presence.
  - Add parse recovery tests for malformed args to ensure `argsRaw` preserved and `args` fallback `{}`.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 2) Remove downstream args re-parsing and consume parsed CST args

- **Commit message**: `refactor(phases): consume parsed args from CST`
- **Files to modify**:
  - `src/bind/binder.ts` (currently reparses at ~lines 131-136)
  - `src/bind/resolver.ts` (currently reparses include args at ~68-70)
  - `src/evaluate/evaluator.ts` (current `parseDirectiveArgs` path at ~77-90)
  - `src/lsp/navigation.ts` (current parse in `extractDefReferencesFromArgs` at ~94-99)
- **Changes**:
  - Replace all `parseArgsObject` usage in bind/evaluate/lsp/resolver with node-level parsed args access.
  - Remove duplicated parse-error diagnostics in these phases.
  - Keep `argsRaw` for diagnostics/LSP display only.
- **Test impact**:
  - Update tests that expected phase-specific args parse diagnostics.
  - Add regression asserting single diagnostic source (parser only) for malformed args.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 3) Evaluator modularization (promoted — prerequisite for Steps 4-8)

- **Commit message**: `refactor(evaluate): split monolithic evaluator into directive handlers`
- **Why now**: The evaluator is 1,227 lines with a monolithic switch. Steps 4, 5, 7, and 8 all modify evaluator logic. By modularizing first, those steps edit isolated ~50-150 line handler files instead of repeatedly patching a monolith.
- **Files to modify/add**:
  - `src/evaluate/evaluator.ts` (reduce to orchestrator ~100-150 LOC)
  - `src/evaluate/handler.ts` (interfaces + `EvalContext`)
  - `src/evaluate/registry.ts` (directive→handler map)
  - `src/evaluate/directives/document.ts`
  - `src/evaluate/directives/def.ts`
  - `src/evaluate/directives/style.ts`
  - `src/evaluate/directives/anchor.ts`
  - `src/evaluate/directives/include.ts`
  - `src/evaluate/directives/lua.ts`
  - `src/evaluate/directives/table.ts`
  - `src/evaluate/directives/layout.ts`
  - `src/evaluate/directives/header-footer.ts`
  - `src/evaluate/directives/ref.ts`
- **Changes**:
  - Introduce handler interfaces for block and inline directives.
  - Move per-directive logic out of switch into dedicated modules.
  - `EvalContext` must provide state access, recursion hooks (`evaluateBlocks`, `evaluateInlines`), parsed args access, and `addDiagnostic`.
  - Preserve exact runtime behavior; this commit is architecture-only, not feature change.
  - Evaluator should already consume parsed CST args from Step 2 — no `parseDirectiveArgs` to migrate.
- **Test impact**:
  - Existing evaluate/include/layout tests should remain semantically unchanged.
  - Add a targeted registry wiring test to assert unknown directives fallback path.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 4) Binder two-pass anchors + inline ref validation; remove hollow styles map

- **Commit message**: `feat(bind): collect anchors and validate refs in bind phase`
- **Files to modify**:
  - `src/bind/binder.ts` (add two-pass traversal; currently block-only traversal ~97+)
  - `src/types/symbols.ts` (remove `styles` map + `StyleSymbol` if unused)
  - `src/style/resolver.ts` (remove dependency on `symbols.styles`)
  - `src/style/index.ts` (reads `symbols.styles` at ~138 — update)
  - `src/evaluate/directives/style.ts` or orchestrator (reads `symbols.styles` at evaluator.ts ~1179 — update)
  - `src/emit/docx/nodes.ts` (remove emit-time undefined-anchor diagnostic at ~569-576)
  - `src/types/diagnostics.ts` (reuse `DiagnosticCode.UNDEFINED_ANCHOR`)
- **Changes**:
  - Pass 1: collect `@anchor(id: ...)` into `symbols.anchors`.
  - Pass 2: traverse inline directives and validate `@ref(id: ...)` targets exist.
  - Remove `SymbolTable.styles` now (do not invent style extraction heuristics).
  - Remove all three `symbols.styles` consumers: `style/index.ts:138`, `style/resolver.ts:59`, evaluator ~1179.
  - Anchor missing target now a bind diagnostic, not emit warning.
- **Test impact**:
  - Bind tests should assert undefined anchor detection in bind phase.
  - Emit tests updated to stop expecting cross-ref missing target warnings.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 5) Anchor IR redesign (`Anchor` block, remove inline `Bookmark`)

- **Commit message**: `refactor(ir): model anchors as block nodes`
- **Files to modify**:
  - `src/types/document-ir.ts` (add `Anchor` block, remove `Bookmark` inline from union)
  - `src/evaluate/directives/anchor.ts` (emit `Anchor` block instead of `Paragraph` + inline `Bookmark`)
  - `src/emit/docx/nodes.ts` (handle `Anchor` in block switch; remove inline `Bookmark` case at ~436)
  - `src/emit/docx/index.ts` (bookmark collection pass at ~129+ should scan `Anchor` blocks)
- **Changes**:
  - New block shape: `{ type: "Anchor", id: string }`.
  - Stop synthesizing empty paragraph with inline bookmark.
  - Ensure emitter writes actual DOCX bookmark at block position.
- **Test impact**:
  - `src/evaluate/layout.test.ts` anchor expectations will change.
  - DOCX emission tests should assert anchor output still supports `@ref` links.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 6) `@lua` raw-body parsing with balanced brace scanning

- **Commit message**: `feat(parse): add raw-body parsing for lua directives`
- **Files to modify**:
  - `src/types/cst.ts` (introduce `RawBody` and body union)
  - `src/parse/parser.ts` (directive-specific body parse path for `@lua`)
  - `src/evaluate/directives/lua.ts` (execute `RawBody.text` directly; remove paragraph reconstruction)
  - `src/bind/contracts.ts` (keep `lua` contract as args none/body required)
- **Changes**:
  - Add `RawBody` model: `{ kind: "RawBody", format: "lua", text: string, loc }`.
  - Parser uses balanced-brace scanner that respects Lua strings/comments.
  - Lua handler executes `RawBody.text` exactly.
- **Test impact**:
  - Add parser tests for nested `{}` in Lua tables and braces inside comments/strings.
  - Update pipeline tests that currently rely on paragraph-body fallback.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 7) Enforce SOL list marker gating in lexer

- **Commit message**: `fix(lexer): gate list markers to start-of-line`
- **Files to modify**:
  - `src/parse/lexer.ts` (current marker detection in `scanDirective` around ~192+)
  - `src/parse/lexer.test.ts`
- **Changes**:
  - Track line-start state and whether non-whitespace already appeared on line.
  - Recognize `@-`/`@#`/`@@-`/`@@#` as markers only at SOL after optional indentation.
  - Mid-line sequences tokenize as normal directive/text.
- **Test impact**:
  - Add regression for `[@mention @-text]`-style mid-line patterns not becoming list markers.
  - Keep existing indented list marker behavior passing.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 8) Dead code purge: remove CST `Include`, remove `Heading` IR/emitter

- **Commit message**: `refactor(types): remove dead include and heading surfaces`
- **Files to modify**:
  - `src/types/cst.ts` (remove `Include` node/union entries around ~35 and ~156)
  - `src/types/document-ir.ts` (remove `Heading` interface and union usage around ~133 and ~365)
  - `src/evaluate/directives/` (remove any Heading handling — likely none after modularization, but verify)
  - `src/emit/docx/nodes.ts` (remove heading emit branch/imports around ~166)
  - `src/emit/docx/index.ts` (remove heading-anchor scan branch around ~143)
  - `src/style/resolver.ts` and other type consumers as needed
- **Changes**:
  - Remove only dead surfaces; keep Footnote/FootnoteRef backend code intact.
  - Preserve behavior of heading-like output via paragraph styles (`Heading1`, etc.).
- **Test impact**:
  - Update tests importing `Heading` or expecting heading-specific emit behavior.
  - Add coverage proving styled paragraph still maps to heading style id.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`

## 9) Final boundary hardening + integration pass

- **Commit message**: `chore(pipeline): enforce phase boundaries and update docs/tests`
- **Files to modify**:
  - `src/evaluate/evaluator.ts` (orchestrator), `src/bind/binder.ts`, `src/lsp/navigation.ts` (final no-reparse/no-backwrite checks)
  - `src/pipeline/pipeline.test.ts`
  - any touched tests for diagnostics timing shifts
- **Changes**:
  - Assert `EvaluationState.defs` starts as copy of `symbols.defs` and mutates locally.
  - Ensure no phase mutates prior phase outputs.
  - Normalize diagnostics timing expectations (bind vs emit).
- **Test impact**:
  - Add integration assertions for parse→bind→evaluate boundaries.
- **Verification**:
  - `bun test`
  - `bunx tsc --noEmit`
  - `bun run build`

---

## Risk Assessment

1. **Highest risk: parser/CST schema churn**
   - Blast radius: bind, evaluate, LSP, tests.
   - Mitigation: isolate in first two commits; require green tests before moving on.

2. **High risk: evaluator modularization (Step 3)**
   - Blast radius: all directive behaviors (pure structural refactor of 1,227 lines).
   - Mitigation: zero semantic changes; exact same runtime behavior; retain all existing tests.
   - Payoff: Steps 4-8 edit isolated handler files (~50-150 LOC each) instead of the monolith.

3. **High risk: Lua raw-body scanner correctness**
   - Blast radius: parse correctness and evaluator runtime behavior.
   - Mitigation: dedicated scanner tests for braces in strings/comments/long strings and EOF recovery.

4. **Medium risk: anchor diagnostic phase shift (emit → bind)**
   - Blast radius: expected diagnostics in tests/tooling.
   - Mitigation: explicitly update test expectations and keep diagnostic code stable (`B009`).

5. **Medium risk: IR union removals (`Bookmark`, `Heading`)**
   - Blast radius: emitter exhaustiveness and downstream imports.
   - Mitigation: perform removals in focused commits and run full suite + typecheck.

6. **Low risk: SOL gating**
   - Blast radius: edge-case tokenization only.
   - Mitigation: lexer regression fixtures for mid-line markers and indented SOL markers.

---

## Success Criteria

PR #4 is complete when all of the following are true:

1. `bun test` passes (no net test debt) and `bunx tsc --noEmit` is clean.
2. Args are parsed exactly once in parser and consumed as structured CST data downstream.
3. Binder produces immutable static symbols; evaluator mutates only runtime evaluation state.
4. Binder collects anchors and reports undefined `@ref` at bind phase; emitter no longer owns this validation.
5. IR has `Anchor` block and no inline `Bookmark`; anchor emission and cross-references still work.
6. `@lua{}` uses raw-body parsing with balanced-brace handling per spec.
7. Lexer recognizes list markers only at start-of-line per spec.
8. Dead types removed: CST `Include`, IR/emitter `Heading`; Footnote/FootnoteRef backend remains.
9. Evaluator is modularized into handler + registry architecture and no longer monolithic.
10. Pipeline boundaries (Parse -> Bind -> Evaluate -> Style -> Emit) are enforced in code and tests.
