# Commit-by-commit plan (LDOC v3)

## Planning rules

- Keep commits small and testable.
- Prefer correctness gates over feature breadth.
- Do not promote deferred sugar into core without spec updates.
- Fix semantic correctness bugs immediately; schedule DRY/YAGNI refactors separately.

---

## ✅ History (v3.0 Alpha - Completed)

- **0.1 - 3**: Prep and YAGNI cleanup ✅
- **4 - 8**: Core syntax and parser ✅
- **9 - 10**: Desugaring and contracts ✅
- **11 - 12**: Binding and symbols ✅
- **13**: Args parsing ✅
- **14 - 15**: Lua evaluator ✅
- **16 - 18**: DOCX emitter and lists/tables ✅
- **19 - 21**: CLI and LSP basics ✅

---

## Immediate triage policy (agreed)

**Fix now (next implementation commits):**

- footer region parent rules (`@left/@center/@right` inside `@footer`)
- evaluator mappings for layout directives (`@columns`, `@box`, `@header`, `@footer`, `@align`)
- DOCX section wiring so Section IR is emitted as real sections
- regression tests (IR + OOXML) for touched semantics

**Plan, do not mix into same correctness commit:**

- DRY cleanup (args parsing dedupe, length parsing dedupe)
- dead-surface/YAGNI cleanup (unused exports/helpers)
- completion/reference polish unrelated to layout correctness

---

# Phase I - Layout correctness (must-fix semantics)

### Commit 22 - `feat(v3-layout): implement section and column evaluation` ✅

**Context**: evaluator currently flattens layout directives into normal body blocks.

**Changes**

- Update `src/bind/contracts.ts` and `src/bind/validator.ts`:
  - allow `@left/@center/@right` in both `@header` and `@footer` contexts.
- Update `src/evaluate/evaluator.ts`:
  - map `@columns(...)` to IR `Section` with `columns: { count, space }`.
  - map `@box{...}` to IR `Blockquote`.
  - map `@align(value: ...)` to style-aligned block output (without flattening semantics).
  - parse `@header/@footer` region directives into `document.metadata.headers/footers`.
  - ensure header/footer definition blocks do not leak into body output.

**Non-goals (explicitly deferred from this commit):**

- no args parser refactor
- no length parser consolidation
- no LSP completion/refactor work
- no decompiler/HTML work

**Files**

- `src/bind/contracts.ts`
- `src/bind/validator.ts`
- `src/evaluate/evaluator.ts`
- `src/types/document-ir.ts` (only if structure extension is required)

**Done when**

- `compileToDocument` on a columns fixture produces a `Section` node.
- `@footer{ @center[...] }` produces no misplaced-directive warning.
- header/footer content appears in metadata, not in `document.blocks`.

### Commit 22.1 - `test(v3-layout): add evaluator regression tests for layout mappings`

**Context**: prevent semantic regressions while wiring emit and imports.

**Changes**

- Add evaluator tests for:
  - `@columns` -> `Section`
  - `@box` -> `Blockquote`
  - `@header/@footer` metadata extraction
  - no header/footer content leakage into body blocks
- Add contract validation test for footer regions (`@footer { @center[...] }`).

**Files**

- `src/evaluate/*.test.ts` (new)
- `src/bind/*.test.ts` (new or existing test location)

**Done when**

- regressions in layout semantics fail before DOCX emit stage.

---

### Commit 23 - `feat(v3-data): implement includes and params names validation` ✅

**Context**: include resolution is stubbed; params contracts are not enforced.

**Issues found while planning (must account for in this commit):**

- `src/bind/resolver.ts` is fully stubbed and currently returns empty symbols/paths.
- `src/pipeline/index.ts` only calls `bindSync` and never routes `sourcePath/loadFile` into bind/resolve.
- `@include` currently falls through evaluator default path and emits nothing when body is absent.
- `@params` is validated as a known directive, but has no evaluation-time contract enforcement.

**Implementation shape**

- Keep include semantics in EVALUATE (content expansion), and keep dependency graph/cycle checks in BIND.
- Start with strict v3-core contract only: `@params(names: [...])` where names are strings.
- Emit deterministic diagnostics with stable codes and source locations (include callsite for missing arg; included file location for params declaration errors).

**Step-by-step checklist**

1. **Path + graph resolution in BIND**
   - Implement `resolveImports` traversal for `@include(path: ...)` directives.
   - Resolve relative paths against entry `sourcePath`.
   - Track visited/import stack to detect and report cycles once.
2. **Pipeline wiring**
   - Thread `CompileOptions.sourcePath` and a loader into bind/resolve path.
   - Ensure parseAndBind tooling path can opt out cleanly when loader/path absent.
3. **Include expansion in EVALUATE**
   - Parse `@include` args (`path`, optional `args` object).
   - Load, parse, bind, and evaluate child source in isolated scope.
   - Merge child output blocks into parent output at callsite order.
4. **Params contract enforcement**
   - Scan included CST top-level for `@params(names: [...])`.
   - Validate provided `args` contains all required names.
   - Emit diagnostics for malformed params declaration and missing args.
5. **Regression coverage**
   - include happy path (content appears in parent document).
   - missing arg -> error diagnostic.
   - import cycle -> single stable diagnostic.
   - malformed params declaration -> error diagnostic.

**Changes**

- Implement import resolution in `src/bind/resolver.ts`:
  - resolve relative include paths from source path.
  - parse included files and collect diagnostics.
  - detect import cycles and emit diagnostics.
- Update pipeline wiring in `src/pipeline/index.ts` to use resolver path for compile flows.
- Update `src/evaluate/evaluator.ts` include behavior:
  - evaluate `@include(path: ..., args: {...})` by loading and evaluating child CST.
  - enforce v3-core params contract using `@params(names: [...])` only.
  - validate required names in `args` and emit diagnostics for missing keys.
  - isolate scope so included definitions do not mutate caller scope unless explicitly intended.

**Files**

- `src/bind/resolver.ts`
- `src/pipeline/index.ts`
- `src/evaluate/evaluator.ts`

**Done when**

- included content renders in parent output.
- missing required include arg (from `@params(names: [...])`) emits an error diagnostic.
- simple import cycle is reported once with stable diagnostic output.
- compile path respects `sourcePath` for relative includes.

---

# Phase J - LSP parity for v3 directives

### Commit 24 - `feat(lsp): implement directive autocompletion from contracts` ✅

**Context**: completion currently uses local hardcoded list and stub behavior.

**Changes**

- Update `src/lsp/completion.ts`:
  - source directive names from `knownDirectiveNames()`.
  - keep snippet support for structural directives (`@table`, `@columns`, `@header`, `@footer`).
  - preserve prefix filtering and non-directive fallback behavior.

**Files**

- `src/lsp/completion.ts`
- `src/bind/contracts.ts` (only if completion metadata needs extension)

**Done when**

- typing `@` shows contract-backed completion list.
- new directive added to contracts appears in completion without extra wiring.

---

# Phase K - DOCX layout emission correctness

### Commit 25 - `fix(docx-layout): compile Section IR into real DOCX sections`

**Context**: section/columns data is not fully wired through emit path.

**Issues found while planning (must fix in this commit):**

- `emitSection` currently flattens section content and drops section semantics.
- `SectionBuilder.addColumns` is implemented but not called from document compilation path.
- header/footer config lookup is split between metadata and section fallback with dead helper imports.
- column breaks can be emitted even when no real section columns are emitted, producing invalid layout intent.

**Changes**

- Update `src/emit/docx/index.ts` and `src/emit/docx/sections.ts`:
  - convert IR `Section` nodes into DOCX sections using `SectionBuilder.addColumns`.
  - apply metadata headers/footers to section builder correctly.
  - avoid flattening section boundaries during `emitBlocks` pass.
- Update `src/emit/docx/nodes.ts` to keep section emission behavior consistent with document-level section construction.

**Files**

- `src/emit/docx/index.ts`
- `src/emit/docx/sections.ts`
- `src/emit/docx/nodes.ts`
- `src/types/document-ir.ts` (if footer config shape needs explicit separation)

**Done when**

- columns fixture creates DOCX with section column config in `word/document.xml`.
- header/footer fixture emits corresponding header/footer references in section properties.

---

# Phase L - Validation harness (prevent regressions)

### Commit 26 - `test(docx): add OOXML assertion harness`

**Context**: current smoke checks build success only, not structural correctness.

**Changes**

- Add test helpers to unzip DOCX and inspect OOXML parts.
- Add assertions for:
  - section/column properties in `word/document.xml`.
  - numbering schema in `word/numbering.xml`.
  - style declarations in `word/styles.xml`.
  - header/footer part linkage.

**Files**

- `src/emit/docx/*.test.ts` (new)
- optional helper under `src/emit/docx/test-utils.ts`

**Done when**

- failing layout regressions are caught by automated tests without manual Word inspection.

---

### Commit 27 - `test(pipeline): add evaluator + include regression fixtures`

**Context**: evaluator behavior for layout/include currently has no targeted tests.

**Changes**

- Add evaluator tests for:
  - `@columns`, `@box`, `@header`, `@footer`, `@align` mappings.
  - include + params names validation.
- Extend fixture set with minimal layout/include fixtures.
- Keep `dev-smoke` focused on end-to-end compile sanity (not replacing structural tests).

**Files**

- `src/evaluate/*.test.ts` (new)
- `fixtures/*.ldoc` (additions)
- `src/cli/dev-smoke.ts` (optional fixture list update)

**Done when**

- regressions in IR semantics fail tests before reaching emit.

---

# Phase M - DX and diagnostics polish

### Commit 28 - `feat(lsp): reference lookup for @def usages`

**Context**: references provider is still stubbed.

**Changes**

- Implement `getReferences` in `src/lsp/navigation.ts` for `@def` keys in args/style refs.
- Ensure include-declaration toggle works for LSP clients.

**Done when**

- find-references returns declaration and usage locations consistently.

---

### Commit 29 - `feat(diagnostics): add directive suggestions and fix-it hints`

**Context**: diagnostics are correct but not always actionable.

**Changes**

- add did-you-mean suggestions for unknown directives.
- add targeted guidance for misplaced header/footer region directives.

**Done when**

- common authoring mistakes produce actionable diagnostics with stable suggestion ordering.

---

## Deferred to sugar backlog (not in v3 core path)

- typed include params (`SG-001`)
- direct expression args (`SG-002`)
- markdown emphasis sugar (`SG-004`)
