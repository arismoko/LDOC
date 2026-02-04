# Refactor Proposal (No Code Changes Yet)

This document captures the highest-value refactor opportunities in this repo, plus a safe sequencing plan. It intentionally does **not** implement any refactors.

## Context

The project compiles/decompiles an LDOC (legal document DSL) to/from DOCX.

Oracle review + repo scan confirm the main pain is *scale + mixed concerns* in a few files:

- `src/compiler/docx.ts` (~2650 lines / ~90KB): `DocxCompiler` is a monolith mixing template/control-flow expansion, style/layout parsing, anchor/bookmark management, and DOCX emission; heavy use of `any`/casts.
- `src/parser/parser.ts` (~1800 lines / ~50KB): `Parser` handles many directives; large dispatch surface (notably `isBlockStart`).
- `src/parser/lexer.ts`: large lexer/tokenizer; hard to extend safely.
- `src/decompiler/docx.ts` (~1170 lines / ~40KB): untyped OOXML traversal (`XmlNode = Record<string, any>`), many ad-hoc helpers.
- `tests/parser.test.ts` (~1750 lines / ~60KB): covers multiple subsystems in one file, making failures harder to localize.

## Goals

- Make changes safer: smaller modules, clearer boundaries, better invariants
- Reduce cognitive load: separate "transform" from "emit" from "I/O"
- Improve error quality: consistent messages + structured error types
- Improve testability: smaller tests, targeted unit coverage, characterization tests for tricky behavior

## Refactor Targets (Highest Value)

1) Split `DocxCompiler` into coherent modules (biggest win)

Why: `src/compiler/docx.ts` mixes at least 4 layers of concern.
- Template/control-flow expansion (e.g. `pruneControls` ~line 848; `substituteLocalsInNode` ~line 952)
- Layout + style extraction
- Anchor/bookmark indexing + resolution
- DOCX object emission

Proposed mechanical split (no behavior change):
- `src/compiler/types.ts` (interfaces/constants)
- `src/compiler/numbering.ts` (numbering config)
- `src/compiler/template-expansion.ts` (define/use + if/foreach/repeat pruning)
- `src/compiler/layout-extraction.ts` (parse lengths/margins/spacing; extract @document layout)
- `src/compiler/style-builder.ts` (document styles)
- `src/compiler/anchor-manager.ts` (bookmark/anchor indexing and refs)
- `src/compiler/node-compilers.ts` (block compilers)
- `src/compiler/inline-compilers.ts` (inline compilation)
- Keep `src/compiler/docx.ts` as a slim orchestrator (plus public entrypoints)

2) Parser decomposition by directive families

Why: `src/parser/parser.ts` is a large recursive descent parser with a huge dispatch surface (`isBlockStart`, many `parseX` methods).

Suggested boundaries:
- `src/parser/control-flow-parsers.ts` (`@if`, `@repeat`, `@foreach`)
- `src/parser/template-parsers.ts` (`@define`, `@use` + signature parsing)
- `src/parser/block-parsers.ts` (headers/items/modifiers/tables, etc.)
- `src/parser/inline-parsers.ts` (inline content/token-to-inline)
- Keep `src/parser/parser.ts` core state + dispatch + shared helpers

3) Decompiler: add XML helpers + types before logic changes

Why: `src/decompiler/docx.ts` uses `XmlNode = Record<string, any>` and ad-hoc traversal; this is fragile and hard to test.

Suggested boundaries:
- `src/decompiler/xml-types.ts` (minimal typed shapes; start small)
- `src/decompiler/xml-helpers.ts` (pure traversal helpers)
- `src/decompiler/paragraph-parser.ts`, `src/decompiler/table-parser.ts`, `src/decompiler/section-parser.ts`, `src/decompiler/numbering-parser.ts`

4) Tests: split + add characterization suite

Why: `tests/parser.test.ts` is large and spans multiple concerns; it slows iteration and makes regression detection noisy.

Suggested actions:
- Split into focused test files (`tests/lexer.test.ts`, `tests/parser.test.ts`, `tests/compiler.test.ts`, `tests/decompiler.test.ts`, etc.)
- Add new `tests/characterization/` tests to lock current semantics before moving logic

## Suggested Sequencing (Safe, Incremental)

Phase 0: Guardrails (low risk, blocking)
- Add characterization tests specifically around compiler expansion/control flow and anchor resolution.
- Add DOCX snapshot-ish assertions by unzipping output and checking `word/document.xml` (and numbering/styles where relevant).
- Add a small set of error-message tests (locks user-facing errors while refactoring internals).

### Phase 0: Safer Characterization Strategy

The examples in this document (and older inline test strings) may drift from actual parser behavior. Use a **generate-from-source** approach to ensure fixtures always reflect the current implementation.

#### Fixture Generation: Always Derive from Parser Tests

**Problem:** Hand-written examples can become stale if parser behavior evolves.

**Solution:** Generate golden fixtures programmatically from parser test cases:

```bash
# Generate fixture snapshots from current parser behavior
bun run scripts/generate-fixtures.ts
```

The generation script should:

1. **Extract test cases from `tests/parser.test.ts`** by parsing the inline LDOC strings
2. **Run each through Parser + DocxCompiler** to produce actual output
3. **Write normalized XML snapshots** to `tests/fixtures/generated/`
4. **Include metadata** (source test name, generation timestamp, parser version)

Example script structure (`scripts/generate-fixtures.ts`):

```typescript
// For each test case in parser.test.ts that compiles to DOCX:
// 1. Parse the inline LDOC string
// 2. Compile to DOCX buffer
// 3. Extract and normalize XML parts
// 4. Write to tests/fixtures/generated/<test-name>/
//    - document.xml (normalized)
//    - numbering.xml (normalized)
//    - styles.xml (normalized)
//    - meta.json (test name, timestamp, input hash)
```

#### When to Keep Examples as Docs-Only

Keep examples in documentation (README, AGENTS.md, legal-dsl-spec.md) **without** using them as test fixtures when:

- **Illustrative, not exhaustive:** The example shows syntax, not edge cases
- **Aspirational:** The example describes intended future behavior
- **Incomplete:** The example omits context required for compilation (no `@document` block, etc.)
- **Formatting-focused:** The example shows human-readable formatting, not machine-precise output

Mark docs-only examples clearly:

```markdown
<!-- DOC-ONLY: This example is illustrative. See tests/characterization/ for regression tests. -->
```

#### Automatic Fixture Validation

Add a CI check that validates fixtures are current:

```bash
# In CI or pre-commit hook
bun run scripts/validate-fixtures.ts
```

Validation script should:

1. **Re-generate fixtures** from current parser tests (in memory, not written)
2. **Compare against committed fixtures** using normalized diff
3. **Fail if any drift detected** with clear diff output
4. **Provide regeneration command** in error message

```typescript
// scripts/validate-fixtures.ts pseudocode
for each committed fixture:
  regenerate from source test case
  if normalized(committed) !== normalized(regenerated):
    console.error(`Fixture drift: ${name}`)
    console.error(`Run: bun run scripts/generate-fixtures.ts`)
    process.exit(1)
```

#### Avoiding Brittleness in DOCX XML Assertions

**Problem:** DOCX XML contains volatile/non-deterministic content that breaks exact-match assertions:
- `w:rsidR`, `w:rsidRPr`, `w:rsidP` (revision IDs)
- Relationship IDs (`rId1`, `rId2`, etc.) can vary by generation order
- Numbering IDs (`numId`, `abstractNumId`) can shift
- Whitespace in XML serialization

**Solution:** Use structural assertions, not string equality.

**Normalization functions to implement:**

```typescript
// tests/helpers/docx-normalize.ts

export function normalizeDocumentXml(xml: string): string {
  return xml
    // 1. Strip revision IDs (volatile per-edit tracking)
    .replace(/\s*w:rsid\w+="[^"]*"/g, '')
    // 2. Collapse whitespace between tags
    .replace(/>\s+</g, '><')
    // 3. Sort attributes alphabetically for stable comparison
    .replace(/<(\w+)([^>]+)>/g, (_, tag, attrs) => 
      `<${tag}${sortAttributes(attrs)}>`)
}

export function normalizeNumberingXml(xml: string): string {
  // Replace numId/abstractNumId values with placeholders
  // based on their order of first appearance
  let numIdMap = new Map<string, number>();
  let counter = 0;
  return xml.replace(/w:numId="(\d+)"/g, (_, id) => {
    if (!numIdMap.has(id)) numIdMap.set(id, counter++);
    return `w:numId="NUM_${numIdMap.get(id)}"`;
  });
}
```

**Preferred assertion patterns:**

```typescript
// ❌ BRITTLE: Exact string match
expect(xml).toContain('<w:bookmarkStart w:id="0" w:name="EXHIBIT_B"/>');

// ✅ BETTER: Structural presence check
expect(xml).toMatch(/w:bookmarkStart[^>]*w:name="EXHIBIT_B"/);

// ✅ BEST: Parse and query
const doc = parseXml(xml);
expect(doc.querySelector('w\\:bookmarkStart[w\\:name="EXHIBIT_B"]')).toBeTruthy();

// ❌ BRITTLE: Exact attribute order
expect(xml).toMatch(/w:pgMar w:top="1440" w:right="2880"/);

// ✅ BETTER: Individual attribute checks
expect(xml).toMatch(/w:pgMar[^>]*w:top="1440"/);
expect(xml).toMatch(/w:pgMar[^>]*w:right="2880"/);
```

**Structural assertion helpers to create:**

```typescript
// tests/helpers/docx-assertions.ts

export function assertBookmarkExists(xml: string, name: string) {
  expect(xml).toMatch(new RegExp(`w:bookmarkStart[^>]*w:name="${name}"`));
}

export function assertHyperlinkToAnchor(xml: string, anchor: string) {
  expect(xml).toMatch(new RegExp(`w:hyperlink[^>]*w:anchor="${anchor}"`));
}

export function assertNumberingFormat(xml: string, level: number, format: string) {
  // Match <w:lvl w:ilvl="N">...<w:numFmt w:val="FORMAT"/>
  const levelPattern = new RegExp(
    `<w:lvl[^>]*w:ilvl="${level}"[^>]*>[\\s\\S]*?<w:numFmt[^>]*w:val="${format}"`,
    'm'
  );
  expect(xml).toMatch(levelPattern);
}

export function assertStyleApplied(xml: string, styleId: string) {
  expect(xml).toMatch(new RegExp(`w:pStyle[^>]*w:val="${styleId}"`));
}
```

### Phase 0: Fixture Inventory (Use What We Have)

Existing repo assets that can serve as golden inputs/outputs:

- LDOC samples:
  - `examples/purchase-agreement.ldoc` (broad coverage; good end-to-end regression)
  - `examples/will.ldoc` (different structure; good end-to-end regression)
  - `examples/define-use-example.ldoc` (define/use behavior; currently notes it does not use params)
  - `examples/indent-outdent-test.ldoc` (indent/outdent modifiers)
  - `examples/powell/toc_POWELL.ldoc` (layout-heavy; margins/indentation in points)
  - `tests/fixtures/imports/main.ldoc` + `tests/fixtures/imports/lib.ldoc` (import resolution)

- DOCX samples:
  - `examples/purchase-agreement.docx`
  - `examples/will.docx`
  - `examples/indent-outdent-test.docx`
  - `examples/powell/toc_POWELL.recompiled.docx` (useful for decompile→recompile stability)

### Phase 0: Minimal Fixture Set (Recommended)

Keep Phase 0 small and targeted. Prefer LDOC strings embedded in tests unless a fixture file materially improves readability.

**Fixture Generation Checklist (Before Writing Characterization Tests):**

- [ ] Create `scripts/generate-fixtures.ts` that extracts test cases from `tests/parser.test.ts`
- [ ] Create `tests/helpers/docx-normalize.ts` with XML normalization functions
- [ ] Create `tests/helpers/docx-assertions.ts` with structural assertion helpers
- [ ] Generate initial fixtures: `bun run scripts/generate-fixtures.ts`
- [ ] Add `scripts/validate-fixtures.ts` for CI drift detection
- [ ] Add fixture validation to CI pipeline or pre-commit hook

Recommended "minimal but sufficient" set (names are test-case labels, not new syntax claims):

- Template expansion:
  - `define_use_basic`
  - `define_use_nested_scoping`
  - `define_use_inside_control_flow` (e.g. within `@if`/loop blocks if supported)
  - `define_use_errors` (unknown template, recursion guard, missing args if params are supported)

- Control flow:
  - `if_true_false_branches`
  - `nested_if_repeat_foreach` (only features that exist today)
  - `missing_end_errors` (e.g. `@repeat`/`@foreach`/`@if` without terminator)

- Anchors/xrefs:
  - `anchor_explicit_and_ref`
  - `anchor_autoname_and_ref`
  - `unresolved_ref_errors` (and allow_undefined behavior if it exists)

- Numbering:
  - `nested_numbering_three_levels`
  - `numbering_scheme_switch` (if `@document numbering:` exists)
  - `numbering_reset_or_continuation` (document current behavior)

- Decompiler:
  - `decompile_roundtrip_purchase_agreement` (use existing `examples/purchase-agreement.docx`)
  - `decompile_roundtrip_will` (use existing `examples/will.docx`)
  - `decompile_edge_unknown_style` (only if we can source/produce such a docx fixture)

### Phase 0: DOCX Snapshot Testing Approach (Deterministic)

Avoid snapshotting the `.docx` binary. Snapshot normalized XML parts instead.

Recommended parts to assert:
- `word/document.xml` (structure + text)
- `word/styles.xml` (styles)
- `word/numbering.xml` (lists)
- Optional: `word/_rels/document.xml.rels` if hyperlinks/anchors matter

Normalization rules (start minimal; add only when flakiness appears):

- Strip volatile revision IDs: remove attributes starting with `w:rsid`
- Normalize whitespace: collapse repeated whitespace in text nodes
- If relationships IDs (`rIdN`) are unstable, normalize them (either by sorting rels by Target then re-indexing, or by regex placeholder replacement)
- If numbering IDs (`numId`, `abstractNumId`) are unstable, normalize with placeholders before snapshotting

Target assertions (prefer structural markers over full exact XML):
- presence of expected text runs
- presence of expected styles (by styleId/name)
- presence of expected numbering formats/levels
- presence of expected bookmarks/hyperlinks for xrefs

Phase 1: Mechanical splits (no behavior change)
- Split monolithic modules into multiple files with re-exports, keeping the same logic.
- Goal: reduce file size and isolate concerns without changing behavior.

Phase 2: Type tightening at boundaries
- Replace `any` at module edges with `unknown` + narrowing.
- Introduce small helper types/guards for the data that crosses stages.

Phase 3: Pipeline formalization
- Introduce explicit compiler stages and a normalized internal representation.
- Ensure each stage has tests and clear invariants.

Phase 4: Decompiler cleanup
- Extract OOXML utilities and add targeted tests for XML traversal/mapping.

## Minimal Characterization Tests (Recommended)

Create `tests/characterization/`:

- `tests/characterization/compiler-template-expansion.test.ts`
  - nested `@define/@use` scoping
  - `@use` inside `@repeat/@foreach`
  - substitution behavior when locals are missing

- `tests/characterization/compiler-control-flow.test.ts`
  - `@foreach` with nested `@if` uses loop scope
  - `@repeat` inside `@if` (and vice versa)
  - verify evaluation order/short-circuit behaviors currently relied upon

- `tests/characterization/compiler-anchor-resolution.test.ts`
  - anchor indexing rules (auto names, prefixes)
  - duplicate anchor collisions (whatever behavior currently is)
  - `[[ref]]` resolution to bookmarks

- `tests/characterization/decompiler-xml-traversal.test.ts`
  - unknown styles
  - missing attrs / malformed nodes
  - TOC-ish paragraphs if supported

## Risks / Regressions To Watch

- Macro expansion and scoping rules: easy to subtly change behavior
- Control flow evaluation order and short-circuiting semantics
- DOCX formatting/styling: small changes can shift output structure
- Decompiler heuristics: can regress on real-world DOCX variations
- Performance: extra passes can add overhead if not careful

## High-Risk Areas To Avoid Until Later

- Condition evaluation internals embedded in template expansion (operator/precedence edge cases): extract first, do not redesign.
- Loop scoping + substitution behavior: lock with characterization tests before touching.
- Numbering/stateful list behavior: changes here ripple through all numbered items.
- Inline tokenization/formatting edge cases: defer until tests are strong.

## Verification Plan (Before/After Each Phase)

- Run unit tests: `bun test`
- Run targeted tests while iterating:
  - `bun test tests/parser.test.ts`
  - `bun test -t "<pattern>"`
- Build: `bun run build`
- Typecheck: `bunx tsc -p tsconfig.json`

Optional (if tooling available):
- Markdown lint: `bunx markdownlint-cli2 "**/*.md"`

## Non-Goals (For This Pass)

- No behavior changes without characterization tests first
- No public API redesign until pipeline boundaries are proven internally
- No formatting/lint tool rollout unless it measurably reduces churn

## Notes

If you want, the next step is to pick one target (recommended: #2 macro expansion extraction) and start with Phase 0 characterization tests to lock in behavior.

---

# Hardened Refactor Checklist

## Phase-by-Phase Acceptance Criteria

### Phase 0: Guardrails (BLOCKING — must complete before any code moves)

**Exit Criteria (ALL must be true to proceed to Phase 1):**

- [ ] `tests/characterization/` directory exists with ≥4 test files
- [ ] Template expansion tests exist and pass:
  - [ ] Nested `@define/@use` scoping (≥3 cases)
  - [ ] `@use` inside `@repeat/@foreach` (≥2 cases)
  - [ ] Missing local substitution behavior documented
- [ ] Control flow tests exist and pass:
  - [ ] `@foreach` + nested `@if` with loop scope (≥2 cases)
  - [ ] `@repeat` inside `@if` and vice versa (≥2 cases)
  - [ ] Evaluation order verification (≥1 case)
- [ ] Anchor resolution tests exist and pass:
  - [ ] Auto-naming rules (≥2 cases)
  - [ ] Duplicate anchor behavior documented
  - [ ] `[[ref]]` → bookmark resolution (≥2 cases)
- [ ] DOCX snapshot tests exist:
  - [ ] At least 1 test unzips output and asserts on `word/document.xml`
  - [ ] At least 1 test checks `word/numbering.xml` or `word/styles.xml`
- [ ] Error message tests exist (≥3 cases locking user-facing errors)
- [ ] All existing tests pass: `bun test` exits 0
- [ ] Build passes: `bun run build` exits 0
- [ ] Typecheck passes: `bunx tsc -p tsconfig.json` exits 0

**Verification command:**
```bash
bun test && bun run build && bunx tsc -p tsconfig.json
```

---

### Phase 1: Mechanical Splits (no behavior change)

**Entry Gate:** Phase 0 complete and verified

**Exit Criteria (ALL must be true to proceed to Phase 2):**

- [ ] Compiler split complete:
  - [ ] `src/compiler/types.ts` exists (interfaces/constants extracted)
  - [ ] `src/compiler/numbering.ts` exists (numbering config extracted)
  - [ ] `src/compiler/template-expansion.ts` exists (define/use + control flow pruning)
  - [ ] `src/compiler/anchor-manager.ts` exists (bookmark/anchor logic)
  - [ ] `src/compiler/docx.ts` reduced to <800 lines (orchestrator only)
  - [ ] `src/compiler/index.ts` re-exports maintain public API unchanged
- [ ] Parser split complete:
  - [ ] `src/parser/control-flow-parsers.ts` exists (@if/@repeat/@foreach)
  - [ ] `src/parser/template-parsers.ts` exists (@define/@use)
  - [ ] `src/parser/parser.ts` reduced to <600 lines (core + dispatch)
  - [ ] `src/parser/index.ts` re-exports maintain public API unchanged
- [ ] Test split complete:
  - [ ] `tests/lexer.test.ts` exists (lexer tests moved)
  - [ ] `tests/compiler.test.ts` exists (compiler tests moved)
  - [ ] `tests/parser.test.ts` reduced to parser-only tests
- [ ] Zero behavior changes:
  - [ ] All characterization tests pass unchanged
  - [ ] All original tests pass unchanged
  - [ ] `bun test` exits 0
  - [ ] `bun run build` exits 0
  - [ ] `bunx tsc -p tsconfig.json` exits 0

**Verification command:**
```bash
bun test && bun run build && bunx tsc -p tsconfig.json
```

---

### Phase 2: Type Tightening

**Entry Gate:** Phase 1 complete and verified

**Exit Criteria (ALL must be true to proceed to Phase 3):**

- [ ] `any` usage reduced:
  - [ ] `src/compiler/` files: `any` count reduced by ≥50%
  - [ ] All `any` at module boundaries replaced with `unknown` + guards
- [ ] Type guards exist:
  - [ ] `src/compiler/guards.ts` or inline guards for cross-stage data
  - [ ] Each guard has ≥1 unit test
- [ ] Narrowing functions documented in code comments
- [ ] All tests pass unchanged
- [ ] No new runtime errors introduced (manual smoke test of CLI)

**Verification command:**
```bash
bun test && bun run build && bunx tsc -p tsconfig.json
# Manual: bun run ldoc -- compile tests/fixtures/<sample>.ldoc -o /tmp/out.docx
```

---

### Phase 3: Pipeline Formalization

**Entry Gate:** Phase 2 complete and verified

**Exit Criteria (ALL must be true to proceed to Phase 4):**

- [ ] Explicit compiler stages defined:
  - [ ] Stage boundaries documented in `src/compiler/README.md` or inline
  - [ ] Each stage has named entry point function
- [ ] Internal representation (IR) introduced:
  - [ ] IR types defined in `src/compiler/types.ts`
  - [ ] At least one stage produces/consumes IR
- [ ] Stage tests exist:
  - [ ] Each stage has ≥2 targeted unit tests
  - [ ] Stage invariants documented and tested
- [ ] All characterization tests still pass
- [ ] Performance not regressed (no new O(n²) patterns introduced)

**Verification command:**
```bash
bun test && bun run build && bunx tsc -p tsconfig.json
```

---

### Phase 4: Decompiler Cleanup

**Entry Gate:** Phase 3 complete and verified

**Exit Criteria:**

- [ ] XML types introduced:
  - [ ] `src/decompiler/xml-types.ts` exists with ≥5 typed shapes
  - [ ] `XmlNode = Record<string, any>` usage reduced by ≥50%
- [ ] XML helpers extracted:
  - [ ] `src/decompiler/xml-helpers.ts` exists with pure traversal functions
  - [ ] Each helper has ≥1 unit test
- [ ] Decompiler modules split:
  - [ ] At least 2 of: `paragraph-parser.ts`, `table-parser.ts`, `section-parser.ts`, `numbering-parser.ts`
  - [ ] `src/decompiler/docx.ts` reduced to <600 lines
- [ ] Characterization tests for decompiler:
  - [ ] Unknown style handling (≥1 case)
  - [ ] Malformed node handling (≥1 case)
- [ ] All tests pass

---

## PR Slicing Strategy

### Phase 0 PRs (4-5 small PRs, no dependencies between them)

| PR | Title | Files | LOC Est. | Dependencies |
|----|-------|-------|----------|--------------|
| 0a | Add characterization test infrastructure | `tests/characterization/` setup, first test file | ~100 | None |
| 0b | Add template expansion characterization tests | `tests/characterization/compiler-template-expansion.test.ts` | ~150 | 0a |
| 0c | Add control flow characterization tests | `tests/characterization/compiler-control-flow.test.ts` | ~120 | 0a |
| 0d | Add anchor resolution characterization tests | `tests/characterization/compiler-anchor-resolution.test.ts` | ~100 | 0a |
| 0e | Add DOCX snapshot tests | `tests/characterization/docx-snapshot.test.ts` | ~150 | 0a |
| 0f | Add error message tests | `tests/characterization/error-messages.test.ts` | ~80 | 0a |

**Merge order:** 0a → (0b, 0c, 0d, 0e, 0f can merge in parallel after 0a)

---

### Phase 1 PRs (6-8 PRs, strict dependencies)

| PR | Title | Files | LOC Est. | Dependencies |
|----|-------|-------|----------|--------------|
| 1a | Extract compiler types to types.ts | `src/compiler/types.ts`, edit `docx.ts` | ~200 | Phase 0 complete |
| 1b | Extract numbering logic | `src/compiler/numbering.ts`, edit `docx.ts` | ~150 | 1a |
| 1c | Extract template expansion | `src/compiler/template-expansion.ts`, edit `docx.ts` | ~400 | 1b |
| 1d | Extract anchor manager | `src/compiler/anchor-manager.ts`, edit `docx.ts` | ~200 | 1c |
| 1e | Extract parser control flow parsers | `src/parser/control-flow-parsers.ts` | ~200 | Phase 0 complete |
| 1f | Extract parser template parsers | `src/parser/template-parsers.ts` | ~150 | 1e |
| 1g | Split test file | `tests/lexer.test.ts`, `tests/compiler.test.ts` | ~300 | Phase 0 complete |

**Merge order:** 
- Compiler track: 1a → 1b → 1c → 1d
- Parser track: 1e → 1f (can run parallel to compiler track)
- Test track: 1g (can run parallel to both)

---

### Phase 2 PRs (3-4 PRs)

| PR | Title | Files | LOC Est. | Dependencies |
|----|-------|-------|----------|--------------|
| 2a | Add type guards for compiler boundaries | `src/compiler/guards.ts`, tests | ~150 | Phase 1 complete |
| 2b | Replace `any` in template-expansion.ts | edit `template-expansion.ts` | ~100 | 2a |
| 2c | Replace `any` in anchor-manager.ts | edit `anchor-manager.ts` | ~80 | 2a |
| 2d | Replace `any` in remaining compiler files | multiple files | ~150 | 2b, 2c |

---

### Phase 3 PRs (2-3 PRs)

| PR | Title | Files | LOC Est. | Dependencies |
|----|-------|-------|----------|--------------|
| 3a | Define compiler stage interfaces | `src/compiler/types.ts`, docs | ~100 | Phase 2 complete |
| 3b | Introduce IR types and first stage | `src/compiler/types.ts`, stage file | ~200 | 3a |
| 3c | Add stage tests and invariant docs | tests, docs | ~150 | 3b |

---

### Phase 4 PRs (3-4 PRs)

| PR | Title | Files | LOC Est. | Dependencies |
|----|-------|-------|----------|--------------|
| 4a | Add decompiler XML types | `src/decompiler/xml-types.ts` | ~100 | Phase 3 complete |
| 4b | Extract XML helpers | `src/decompiler/xml-helpers.ts`, tests | ~150 | 4a |
| 4c | Split decompiler modules | `paragraph-parser.ts`, etc. | ~300 | 4b |
| 4d | Add decompiler characterization tests | `tests/characterization/decompiler-*.test.ts` | ~100 | 4a |

---

## Risk Matrix

### Phase 0: Guardrails

| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| Tests don't capture existing behavior accurately | Medium | High | **6** | Review tests against actual code paths; run against known-good outputs |
| DOCX snapshot tests are brittle (formatting changes) | Medium | Low | **2** | Use structural assertions, not byte-exact matching |
| Time investment delays actual refactor | Low | Low | **1** | Timebox to 1-2 days; accept 80% coverage |

### Phase 1: Mechanical Splits

| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| Import cycles introduced | Medium | Medium | **4** | Plan dependency graph before splitting; types.ts must be leaf |
| Re-export breaks public API | Low | High | **3** | Keep `index.ts` re-exports identical; add API surface test |
| Merge conflicts from parallel work | Medium | Low | **2** | Coordinate PR merge order; avoid editing same lines |
| Subtle behavior change from hoisting/ordering | Low | High | **3** | Characterization tests catch this; diff test output carefully |

### Phase 2: Type Tightening

| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| Over-aggressive typing breaks valid code paths | Medium | Medium | **4** | Add guards incrementally; run full test suite after each change |
| Type guards have bugs (wrong narrowing) | Low | Medium | **2** | Unit test each guard; use exhaustive checks |
| Performance regression from runtime checks | Low | Low | **1** | Guards should be cheap; profile if concerned |

### Phase 3: Pipeline Formalization

| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| IR design is wrong; requires rework | Medium | High | **6** | Start minimal; add fields as needed; don't over-design |
| Extra passes add latency | Medium | Medium | **4** | Benchmark before/after; keep passes lazy if possible |
| Stage boundaries leak abstractions | Medium | Medium | **4** | Document invariants; enforce via types |

### Phase 4: Decompiler Cleanup

| Risk | Likelihood | Impact | Score | Mitigation |
|------|------------|--------|-------|------------|
| Real-world DOCX variations break typed assumptions | High | Medium | **6** | Add characterization tests from real DOCX samples first |
| XML helper changes break decompilation | Medium | High | **6** | Keep helpers pure; test each in isolation |
| Insufficient test coverage for edge cases | Medium | Medium | **4** | Collect diverse DOCX samples before starting |

### Risk Score Legend
- **1-2:** Low priority, proceed with standard caution
- **3-4:** Moderate, have mitigation ready before starting
- **5-6:** High priority, invest in mitigation before proceeding

---

## Concrete First Refactor Recommendation

### After Phase 0 is complete, start here:

**Target:** Extract `src/compiler/types.ts` (PR 1a)

**Why this first:**
1. **Zero behavior change** — purely moving type definitions
2. **No function logic moved** — only interfaces, types, constants
3. **Creates foundation** — all subsequent extractions import from here
4. **Easy to verify** — typecheck alone proves correctness
5. **Low risk** — if something breaks, the fix is obvious

**Specific steps:**

1. Identify all `interface`, `type`, and `const` declarations in `src/compiler/docx.ts` that are:
   - Used by multiple functions, OR
   - Exported, OR
   - Define data structures passed between stages

2. Create `src/compiler/types.ts` with these declarations

3. Add re-exports to `src/compiler/index.ts` if any types were previously exported

4. Update `src/compiler/docx.ts` to import from `./types`

5. Run verification:
   ```bash
   bunx tsc -p tsconfig.json && bun test && bun run build
   ```

6. If all pass, PR is ready

**Estimated time:** 1-2 hours
**Estimated LOC:** ~150-200 lines moved

---

## Quick Reference: Verification Commands

```bash
# Full verification (run after every PR)
bun test && bun run build && bunx tsc -p tsconfig.json

# Quick iteration (run while developing)
bun test -t "<pattern>"

# Characterization tests only
bun test tests/characterization/

# Smoke test CLI
bun run ldoc -- compile <input.ldoc> -o /tmp/out.docx
bun run ldoc -- decompile <input.docx> -o /tmp/out.ldoc
```

---

## Definition of Done (Per PR)

- [ ] All existing tests pass
- [ ] All characterization tests pass
- [ ] Build succeeds
- [ ] Typecheck succeeds
- [ ] No new `any` introduced (Phase 2+)
- [ ] PR description documents what moved, not what changed behaviorally
- [ ] Reviewer can verify no behavior change by diffing test output
