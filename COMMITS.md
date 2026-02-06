# Commit-by-commit plan (LDOC v3)

## 0) Prep: branch + guardrails

### Commit 0.1 — `chore: create v3 branch and add smoke fixtures` ✅

**Status**: ✅ Complete

---

# Phase A — cut legacy scope (YAGNI deletion)

### Commit 1 — `chore: remove decompiler from public API` ✅

**Status**: ✅ Complete

### Commit 2 — `chore(cli): remove decompile command + update help text` ✅

**Status**: ✅ Complete

### Commit 3 — `chore: delete markdown/control-flow surface from v3 build` ✅

**Status**: ✅ Complete

---

# Phase B — establish v3 syntax & CST (the big reset)

### Commit 4 — `feat(v3): define v3 token model` ✅

**Status**: ✅ Complete

### Commit 5 — `feat(v3): define v3 CST shapes` ✅

**Status**: ✅ Complete

### Commit 6 — `feat(v3-lex): rewrite lexer for v3 delimiters + markers` ✅

**Status**: ✅ Complete

### Commit 7 — `feat(v3-parse): rewrite parser for directives + paragraph blocks` ✅

**Status**: ✅ Complete

### Commit 8 — `feat(v3): implement newline normalization inside paragraph blocks` ✅

**Status**: ✅ Complete

---

# Phase C — desugar + directive contracts

### Commit 9 — `feat(v3-desugar): desugar @name[...] into @name{[...]}` ✅

**Status**: ✅ Complete (Handled in Commit 7 parser logic)

### Commit 9.1 — `fix(build): align binder/evaluator imports with v3 CST` ✅

**Status**: ✅ Complete

**Changes**

- Update `src/bind/binder.ts`, `src/bind/validator.ts`, and `src/evaluate/evaluator.ts` to import the NEW type names (`Document`, `Directive`, `Block`) instead of old ones (`CSTDocument`).
- **Do not rewrite logic yet**—just fix imports and cast types/comment out broken code so `bun run smoke` compiles (even if it throws runtime errors).
- Fix `src/parse/parser.ts` to prevent nested `[...]` blocks (Spec 4.2).

**Files**

- `src/bind/binder.ts`
- `src/bind/validator.ts`
- `src/bind/resolver.ts`
- `src/evaluate/evaluator.ts`
- `src/parse/parser.ts`

**Done when**

- `bun run smoke` runs (it may fail logic, but TS must compile).

### Commit 10 — `feat(v3-contracts): add directive registry + validator` ✅

**Status**: ✅ Complete

**Changes**

- Introduce “known directives” registry.
- Rewrite `src/bind/validator.ts` to check against registry (e.g. `@document` allowed only at top, `@row` only in `@table`).

**Files**

- `src/bind/validator.ts`
- `src/bind/contracts.ts` (new)

**Done when**

- Unknown directives produce warnings in the smoke test output.

---

# Phase D — binding (`@def`) + symbols

### Commit 11 — `feat(v3-symbols): replace macro symbols with def symbols`

**Changes**

- Rewrite `src/types/symbols.ts`:
  - Remove `macros` map.
  - Add `defs: Map<string, DefSymbol>`.
  - Update `SymbolTable` interface.

**Files**

- `src/types/symbols.ts`

**Done when**

- `macros` are gone from the codebase.

### Commit 12 — `feat(v3-bind): implement binder for @def scope`

**Changes**

- Rewrite `src/bind/binder.ts` to:
  - Walk v3 CST.
  - Collect `@def(...)` entries into SymbolTable.
  - Handle duplicate definitions diagnostics.

**Files**

- `src/bind/binder.ts`

**Done when**

- `parseAndBind` returns symbols containing definitions from `fixtures/minimal.ldoc` (if any).

---

# Phase E — args parsing via JSON5 object (KISS)

### Commit 13 — `feat(v3-args): parse directive args as JSON5 object` ✅

**Status**: ✅ Complete

---

# Phase F — Lua evaluator (sandboxed)

### Commit 14 — `feat(v3-lua): add lua runtime interface + timeout`

**Changes**

- Create `src/evaluate/lua/runtime.ts` (wrapper around a wasm lua or mock for now, or use a JS-Lua VM like `wasmoon` or `fengari` if available, otherwise mock with simple JS eval restricted for prototype).
- **Note:** For this environment (Node/Bun), we might need a JS-based Lua interpreter. If adding a dependency is too heavy, we can mock expressions for now or use `Function` sandbox as a placeholder if spec allows (Spec says "Lua Evaluation", but for a TS prototype, a simplified expression parser or JS-eval-as-Lua might suffice for Step 1).
- _Decision:_ Use a mock runtime or simple JS eval that simulates Lua syntax for the prototype.

**Files**

- `src/evaluate/lua/runtime.ts`

**Done when**

- `runLua("return 1 + 1")` returns 2.

### Commit 15 — `feat(v3-eval): rewrite evaluator to produce Document IR from v3 CST`

**Changes**

- Rewrite `src/evaluate/evaluator.ts`.
- Walk v3 CST `Document`.
- Execute `@lua{}` blocks.
- Evaluate `$()` expressions using Runtime.
- Output `Document` (IR).

**Files**

- `src/evaluate/evaluator.ts`

**Done when**

- Smoke test produces a valid IR object with evaluated text.

---

# Phase G — DOCX emitter adaptation

### Commit 16 — `feat(v3-emit): wire v3 pipeline parse->bind->eval->style->emit`

**Changes**

- Update `src/pipeline/index.ts` to connect new Evaluator output to Emitter.
- Ensure `src/emit/docx` handles the IR produced by v3 evaluator.

**Files**

- `src/pipeline/index.ts`

**Done when**

- `ldoc compile` produces a valid `.docx` file from v3 source.

### Commit 17 — `fix(docx): list items support multi-paragraph bodies`

**Changes**

- Ensure emitter handles `ListItem` blocks that contain multiple paragraphs.

**Files**

- `src/emit/docx/nodes.ts`

### Commit 18 — `feat(v3-table): implement @table/@row emission path`

**Changes**

- Ensure Evaluator transforms `@table` CST -> Table IR.
- Ensure Emitter handles Table IR correctly.

**Files**

- `src/evaluate/evaluator.ts`
- `src/emit/docx/tables.ts`

---

# Phase H — CLI refresh & LSP MVP

### Commit 19 — `chore(cli): update init template to v3 syntax`

**Files**

- `src/cli/index.ts`

### Commit 20 — `feat(lsp): emit v3 diagnostics from pipeline`

**Files**

- `src/lsp/server.ts`

### Commit 21 — `feat(lsp): go-to-definition for @def keys`

**Files**

- `src/lsp/navigation.ts`

---
