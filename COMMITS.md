Cool — here’s a **commit-by-commit plan** that’s ruthless about YAGNI/KISS and mapped to the files you actually have in `src/`.

I’m assuming you want **one mainline v3** (not “v2 + v3 side-by-side”), but we’ll keep the legacy stuff in git history and/or behind a `legacy/` export.

---

# Commit-by-commit plan (LDOC v3)

## 0) Prep: branch + guardrails

### Commit 0.1 — `chore: create v3 branch and add smoke fixtures` ✅

**Changes**

- Create `fixtures/` with 2–3 tiny `.ldoc` examples:
  - `fixtures/minimal.ldoc`
  - `fixtures/lists.ldoc`
  - `fixtures/table.ldoc`

- Add a tiny dev script `src/cli/dev-smoke.ts` that compiles fixtures to `.docx` in `/tmp` (or prints diagnostics only).

**Files**

- `fixtures/*`
- `src/cli/dev-smoke.ts`

**Done when**

- You can run one command that exercises parse → bind → eval → emit without the LSP.

**Status**: ✅ Complete

---

# Phase A — cut legacy scope (YAGNI deletion)

### Commit 1 — `chore: remove decompiler from public API` ✅

**Changes**

- Stop exporting decompiler from `src/index.ts`
- Keep files in repo for now, but remove from build surface

**Files**

- `src/index.ts` (remove `docxToLdoc, decompile` export)

**Done when**

- Nothing outside `src/decompiler/**` references decompiler.

**Status**: ✅ Complete

---

### Commit 2 — `chore(cli): remove decompile command + update help text` ✅

**Changes**

- Remove `decompile` command and related imports
- Update CLI help + examples

**Files**

- `src/cli/index.ts`

**Done when**

- CLI only supports `compile`, `parse`, `validate`, `init` (or `init-v3`).

**Status**: ✅ Complete

---

### Commit 3 — `chore: delete markdown/control-flow surface from v3 build` ✅

**Changes**

- Mark as "legacy / unused in v3" (don't delete yet if it helps reference):
  - `src/evaluate/control-flow.ts`
  - markdown tokens/nodes usage in evaluator

- If compilation is blocked by imports, stub exports to keep building.

**Files**

- `src/evaluate/control-flow.ts` (stub or remove from exports)
- `src/evaluate/index.ts` (stop exporting legacy helpers)

**Done when**

- No codepath calls `processIf/processForeach/processRepeat` etc.

**Status**: ✅ Complete

---

# Phase B — establish v3 syntax & CST (the big reset)

## The repo is currently inconsistent: `src/parse/parser.ts` expects typed CST shapes that **do not exist** in `src/types/cst.ts`

So we fix this by committing a clean v3 CST + token model and then rewriting lexer/parser to match.

### Commit 4 — `feat(v3): define v3 token model`

**Changes**

- Replace token types to match v3 minimal grammar:
  - remove INDENT/DEDENT
  - add `PARA_OPEN` `PARA_CLOSE` for `[` `]`
  - add `LUA_EXPR_OPEN` `$(` and `LUA_BLOCK_OPEN` `@lua{`
  - add list markers `LIST_BULLET`, `LIST_ORDERED` with depth encoded
  - keep COMMENT + BLANK_LINE

**Files**

- `src/types/tokens.ts`

**Done when**

- Token list matches the spec: directives, args, `{}`, `[]`, `$()`.

---

### Commit 5 — `feat(v3): define v3 CST shapes`

**Changes**

- Replace `src/types/cst.ts` with a v3-first CST:
  - `Document`
  - `Directive { name, argsRaw?, body? }`
  - `StructuralBody { children: Block[] }`
  - `ParagraphBlock { inlines: Inline[] }` representing `[...]`
  - `ListItemMarker { ordered/bullet, depth, argsRaw?, body? }`
  - `InlineText`, `InlineDirective` (if needed), `LuaExpr`, etc.

- Keep `ParseResult` and “incomplete marker” support for diagnostics/recovery.

**Files**

- `src/types/cst.ts`

**Done when**

- Parser can compile against this file without “missing types”.

---

### Commit 6 — `feat(v3-lex): rewrite lexer for v3 delimiters + markers`

**Changes**

- Rewrite `src/parse/lexer.ts` to:
  - treat `[...]` as structural paragraph open/close tokens
  - treat `$(` as Lua expression open token
  - treat `@lua{` as Lua block opener token
  - treat list markers only at line start:
    - `@-`, `@@-`, `@#`, `@@#`, etc.

- Keep COMMENT and BLANK_LINE (for recovery + UX)

**Files**

- `src/parse/lexer.ts`
- `src/parse/index.ts` (if exports change)

**Done when**

- Token stream is stable and contains enough info for parsing without “smart lexer”.

---

### Commit 7 — `feat(v3-parse): rewrite parser for directives + paragraph blocks`

**Changes**

- Rewrite `src/parse/parser.ts` to parse:
  - `@name`
  - `@name(argsRaw)`
  - `@name{ structural body }`
  - `@name[...]` (keep as AST node, desugar later)
  - `[...]` paragraph blocks (non-nestable)
  - list items (markers at line start, optional `{...}` body)

- Error recovery:
  - unterminated `[...]`, `(...)`, `{...}` becomes EOF-close
  - unknown directive still parsed but validated later

**Files**

- `src/parse/parser.ts`
- `src/parse/recovery.ts`

**Done when**

- `parseSource()` returns CST + diagnostics and doesn’t stop at first error.

---

### Commit 8 — `feat(v3): implement newline normalization inside paragraph blocks`

**Changes**

- Within `[...]`:
  - single newline → treated as space (soft wrap)
  - blank line(s) → emit hard line-break tokens (shift+enter semantics)

- Store hard breaks explicitly in paragraph inline list (ex: `InlineHardBreak` count)

**Files**

- `src/parse/parser.ts`
- `src/types/cst.ts` (hard break inline node)

**Done when**

- Your earlier bracket paragraph behavior is correctly represented in CST.

---

# Phase C — desugar + directive contracts

### Commit 9 — `feat(v3-desugar): desugar @name[...] into @name{[...]}`

**Changes**

- Add a pass (new file) that transforms CST into canonical form:
  - `Directive.flowBody` → `Directive.structuralBody(children=[ParagraphBlock])`

**Files**

- `src/pipeline/index.ts` (insert pass after parse)
- `src/shared/` or `src/parse/` new file: `src/parse/desugar.ts`

**Done when**

- Downstream phases only need to handle structural bodies + paragraph blocks.

---

### Commit 10 — `feat(v3-contracts): add directive registry + validator`

**Changes**

- Introduce “known directives” and minimal arg expectations:
  - `@document`, `@def`, `@style`, `@table`, `@row`, `@pagebreak`, `@columns`, `@break`, `@box`, `@align`, `@header`, `@footer`, `@anchor`, `@include`, `@params`, `@lua`

- Args parsing stays raw for now — validator only checks “has args”/“must have body”.

**Files**

- `src/bind/validator.ts` (rewrite to v3 contracts)
- (optional) new `src/bind/contracts.ts`

**Done when**

- Unknown directives become warnings/errors (your choice), but compilation continues.

---

# Phase D — binding (`@def`) + symbols

### Commit 11 — `feat(v3-symbols): replace macro symbols with def symbols`

**Changes**

- Rewrite `src/types/symbols.ts`:
  - remove macros entirely
  - add `defs: Map<string, DefSymbol>`
  - keep `anchors` (optional), maybe keep `styles` (or treat styles as defs)

- Keep `BindResult` structure

**Files**

- `src/types/symbols.ts`

**Done when**

- No `macros` anywhere.

---

### Commit 12 — `feat(v3-bind): implement binder for @def scope`

**Changes**

- Rewrite `src/bind/binder.ts` / `resolver.ts` to:
  - collect `@def(...)` bindings
  - create scoping model (document scope + include scope)
  - record source locations for go-to-definition later

**Files**

- `src/bind/binder.ts`
- `src/bind/resolver.ts`
- `src/bind/index.ts`

**Done when**

- `parseAndBind()` returns a symbol table containing defs.

---

# Phase E — args parsing via JSON5 object (KISS)

### Commit 13 — `feat(v3-args): parse directive args as JSON5 object`

**Changes**

- Add a single helper:
  - `parseArgsObject(argsRaw: string) -> { ok, value } | { ok:false, raw, error }`

- On failure:
  - diagnostic + keep `raw` + treat as `{}` fallback

**Files**

- new `src/shared/args.ts` (or `src/bind/args.ts`)
- `src/bind/validator.ts` (use it to validate shapes)
- `src/evaluate/*` (later uses it too)

**Done when**

- `@directive(key: "value")` works without quoting keys (JSON5 behavior).

---

# Phase F — Lua evaluator (sandboxed)

### Commit 14 — `feat(v3-lua): add lua runtime interface + timeout`

**Changes**

- Create a `LuaRuntime` wrapper with:
  - `evalExpr(expr: string) -> value`
  - `runBlock(code: string) -> void`
  - timeout / cancellation strategy (worker kill is fine initially)

- Define globals to inject:
  - `data`, `defs`, `styles`

**Files**

- new `src/evaluate/lua/runtime.ts`
- `src/evaluate/index.ts`

**Done when**

- You can evaluate `$(1+2)` and surface Lua errors with source spans.

---

### Commit 15 — `feat(v3-eval): rewrite evaluator to produce Document IR from v3 CST`

**Changes**

- Rewrite `src/evaluate/evaluator.ts` to:
  - walk v3 CST
  - build `Document`/`Paragraph`/`List`/`Table` IR
  - evaluate `$()` and insert Text nodes
  - execute `@lua{}` in structural contexts

- Drop all old macro/markdown logic

**Files**

- `src/evaluate/evaluator.ts`
- delete/ignore: `src/evaluate/expander.ts`, `interpolation.ts`, `expressions.ts`

**Done when**

- A minimal fixture compiles into Document IR with evaluated `$()`.

---

# Phase G — DOCX emitter adaptation (vertical slice)

### Commit 16 — `feat(v3-emit): wire v3 pipeline parse->bind->eval->style->emit`

**Changes**

- Update `src/pipeline/index.ts` to use new CST/bind/eval
- Keep style phase temporarily if it still helps docx emission

**Files**

- `src/pipeline/index.ts`

**Done when**

- `compile()` produces a DOCX buffer again.

---

### Commit 17 — `fix(docx): list items support multi-paragraph bodies`

**Changes**

- Ensure list item bodies can emit multiple paragraphs while staying same list item in Word
- This is likely an emitter concern (numPr reuse)

**Files**

- `src/emit/docx/numbering.ts`
- `src/emit/docx/nodes.ts` (where list paragraphs are emitted)

**Done when**

- Fixture: list item with `{ [para1] [para2] }` stays a single item.

---

### Commit 18 — `feat(v3-table): implement @table/@row emission path`

**Changes**

- Ensure evaluator produces `Table -> rows -> cells`
- Ensure DOCX emitter supports it (likely already does)

**Files**

- `src/evaluate/evaluator.ts`
- `src/emit/docx/tables.ts`

**Done when**

- Fixture table emits correctly.

---

# Phase H — CLI refresh

### Commit 19 — `chore(cli): update init template to v3 syntax`

**Changes**

- Update `initCommand` template:
  - use `@document(...) { ... }` or `@document(...)` + `[...]`
  - remove markdown headings for now (use style)
  - include one list + one `$()` sample

**Files**

- `src/cli/index.ts`

**Done when**

- `ldoc init` creates a v3-valid document.

---

# Phase I — LSP MVP (diagnostics + defs navigation only)

### Commit 20 — `feat(lsp): emit v3 diagnostics from pipeline`

**Changes**

- LSP should run parse/bind/eval and publish diagnostics (already structured)

**Files**

- `src/lsp/diagnostics.ts`
- `src/lsp/server.ts`

**Done when**

- Neovim shows parse/eval Lua errors live.

---

### Commit 21 — `feat(lsp): go-to-definition + rename for @def keys`

**Changes**

- Add symbol indexing for defs
- Provide definition locations for references (wherever you decide refs live)

**Files**

- `src/lsp/navigation.ts`
- `src/bind/*` (ensure symbol locations are stored cleanly)

**Done when**

- Cursor on `$(exhibitTitle)` or `@useDef(...)` (whatever ref syntax you choose) jumps to `@def`.

---

# Phase J — Neovim Lua completion (delegate to Lua LSP)

### Commit 22 (optional, editor folder) — `feat(nvim): add tree-sitter injections + lua runtime stub`

**Changes**

- Add editor assets (not core compiler):
  - `editors/nvim/queries/ldoc/injections.scm`
  - stub generator in CLI: `.ldoc/ldoc_runtime.lua` with `data/defs/styles`

**Files**

- new `editors/nvim/**`
- new `src/cli/stubgen.ts` (or add to compile command)

**Done when**

- Lua LSP completes `data.*` inside `$()` in Neovim.

---

# The “stop here” line (good v3 shipping point)

You can ship a serious v3 after Commit **19**:

- v3 parser
- JSON5 args
- Lua eval
- DOCX output
- CLI working

Everything after that is editor polish / productivity.

---
