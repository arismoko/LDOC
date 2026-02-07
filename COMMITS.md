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

**Status**: ✅ Complete

### Commit 9.1 — `fix(build): align binder/evaluator imports with v3 CST` ✅

**Status**: ✅ Complete

### Commit 10 — `feat(v3-contracts): add directive registry + validator` ✅

**Status**: ✅ Complete

---

# Phase D — binding (`@def`) + symbols

### Commit 11 — `feat(v3-symbols): replace macro symbols with def symbols` ✅

**Status**: ✅ Complete

### Commit 12 — `feat(v3-bind): implement binder for @def scope` ✅

**Status**: ✅ Complete

---

# Phase E — args parsing via JSON5 object (KISS)

### Commit 13 — `feat(v3-args): parse directive args as JSON5 object` ✅

**Status**: ✅ Complete

### Commit 13.1 — `chore: delete legacy decompiler and evaluator code` ✅

**Status**: ✅ Complete

---

# Phase F — Lua evaluator (Real Wasmoon Integration)

### Commit 14 — `feat(v3-lua): integrate wasmoon runtime` ✅

**Status**: ✅ Complete

**Changes**

- Install dependency: `bun add wasmoon`
- Create `src/evaluate/lua/runtime.ts`.
- **Implementation Requirements:**
  - Import `LuaFactory` from `wasmoon`.
  - **Factory Setup:** You MUST pass the location of the WASM file explicitly for Bun/Node compatibility.

    ```typescript
    // Hint for the agent:
    const factory = new LuaFactory();
    // wasmoon automatically resolves the wasm binary in Node-like envs,
    // but if it fails, point it to require.resolve('wasmoon/dist/glue.wasm')
    ```

  - **Interface:**
    - `createEnv(data: any, defs: any, styles: any): Promise<LuaEngine>`
    - Expose globals using `lua.global.set('data', data)`, etc.
    - `evaluate(engine: LuaEngine, expression: string): Promise<any>`
    - `execute(engine: LuaEngine, chunk: string): Promise<void>`
  - **Sandboxing:** Ensure `defs` is passed by reference so Lua modifications persist.

**Files**

- `src/evaluate/lua/runtime.ts`

**Done when**

- Unit test: `evaluate("return 1 + 1")` returns `2` (async).
- Unit test: `execute("defs.x = 10")` updates the `defs` object passed in.

### Commit 15 — `feat(v3-eval): rewrite evaluator to produce Document IR`

**Status**: ✅ Complete

**Changes**

- Rewrite `src/evaluate/evaluator.ts` completely.
- Input: v3 `Document` CST + `SymbolTable`.
- **Async Requirement:** Since `wasmoon` is async, the `evaluate()` function must now return `Promise<EvaluateResult>`.
- **Core Loop**:
  - Initialize Lua engine _once_ per document.
  - Populate `data` (from options), `defs` (from symbols), `styles` (from symbols).
  - Walk CST:
    - `LuaExpr` (`$(...)`) -> `await runtime.evaluate(...)`.
    - `@lua{...}` -> `await runtime.execute(...)`.
    - `@def` -> ensure values are accessible in `defs` global.
- **Output:** `Document` IR.

**Files**

- `src/evaluate/evaluator.ts`
- `src/pipeline/index.ts` (update to await the evaluator)

**Done when**

- `ldoc parse fixtures/minimal.ldoc` produces valid IR with `$()` resolved.

---

# Phase G — DOCX emitter adaptation

### Commit 16 — `feat(v3-emit): wire v3 pipeline parse->bind->eval->emit` ✅

**Status**: ✅ Complete

**Changes**

- Update `src/pipeline/index.ts` to handle the `async` nature of the new Evaluator.
- Ensure `src/emit/docx` handles the IR produced by v3 evaluator.

**Files**

- `src/pipeline/index.ts`

**Done when**

- `ldoc compile fixtures/minimal.ldoc` produces a valid `.docx`.

### Commit 17 — `fix(docx): list items support multi-paragraph bodies` ✅

**Status**: ✅ Complete

**Changes**

- Update `src/emit/docx/nodes.ts` (specifically `emitListItem`) to handle `ListItem` nodes that contain multiple child blocks.

**Files**

- `src/emit/docx/nodes.ts`

### Commit 18 — `feat(v3-table): implement @table/@row emission path` ✅

**Status**: ✅ Complete

**Changes**

- Ensure `src/evaluate/evaluator.ts` transforms `@table` directives into `Table` IR nodes.
- Update `src/emit/docx/tables.ts` to handle the specific structure of v3 tables.

**Files**

- `src/evaluate/evaluator.ts`
- `src/emit/docx/tables.ts`

---

# Phase H — CLI refresh & LSP MVP

### Commit 19 — `chore(cli): update init template to v3 syntax` ✅

**Status**: ✅ Complete

**Files**

- `src/cli/index.ts`

### Commit 20 — `feat(lsp): emit v3 diagnostics from pipeline`

**Changes**

- Update `src/lsp/server.ts` to use the new pipeline functions.
- Ensure diagnostics from Parse/Bind/Eval phases are forwarded to the client.

**Files**

- `src/lsp/server.ts`

### Commit 21 — `feat(lsp): go-to-definition for @def keys`

**Changes**

- Update `src/lsp/navigation.ts` to resolve symbols using the new `defs` map in `SymbolTable`.

**Files**

- `src/lsp/navigation.ts`
