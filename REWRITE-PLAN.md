# LDOC Complete Rewrite Plan

## Mission Statement

Build a **professional-grade language toolchain** with:

- **Precision**: Each phase has one job, does it perfectly
- **Elegance**: Clean types, clear data flow, no tangled concerns
- **SOC**: Separation of concerns at every level
- **Debuggability**: Inspectable IR at every phase boundary

---

## Oracle Review Template

Use this prompt when asking @oracle to review phase completion:

```markdown
## Review Request: Phase N (NAME) Completion

You are reviewing Phase N of the LDOC compiler rewrite. Your job is to **APPROVE or DENY** completion.

### Files to Review

**Plan & Context:**
- `/home/ari/Work/tries/2026-02-02-mdsldocx/REWRITE-PLAN.md` - The architecture plan (Phase N section)
- `/home/ari/Work/tries/2026-02-02-mdsldocx/DEFERRED-JOURNAL.md` - Deferred items and decisions

**Old Implementation (for comparison):**
- [list relevant src.bak/ files]

**New Implementation (to review):**
- [list new src/ files]

**Tests:**
- [list test files]

### Review Criteria

**1. Plan Compliance**
- Does the implementation match REWRITE-PLAN.md Phase N spec?
- Are all stated deliverables present?

**2. DRY Violations**
- Is there duplicated code?
- Are there repeated patterns that should be extracted?

**3. YAGNI Violations**
- Is there code that isn't needed yet?
- Are there over-engineered abstractions?
- Features that should be deferred to later phases?

**4. KISS Violations**
- Is the code unnecessarily complex?
- Could simpler approaches achieve the same result?
- Are there convoluted patterns that could be straightened?

**5. Test Coverage**
- Are critical paths tested?
- Are edge cases covered?
- Any obvious gaps?

**6. Type Safety**
- Proper use of TypeScript strict mode?
- Any unsafe type assertions that could be avoided?

### Output Format

Respond with:

## VERDICT: [APPROVE / DENY]

### Summary
[1-2 sentence summary]

### DRY Issues
[List any violations, or "None found"]

### YAGNI Issues  
[List any violations, or "None found"]

### KISS Issues
[List any violations, or "None found"]

### Other Issues
[Any other concerns]

### Required Changes (if DENY)
[Numbered list of must-fix items]

### Recommendations (if APPROVE)
[Optional improvements for later]

Be strict. Deny if there are significant violations.
```

---

## Architecture: The 5-Phase Pipeline

```
LDOC Source
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: PARSE                                                          │
│ Input:  Source text                                                     │
│ Output: CST (Concrete Syntax Tree)                                      │
│ • Lossless (can reconstruct source)                                     │
│ • Source locations on every node                                        │
│ • No semantic knowledge - @define/@if are just directive nodes          │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: BIND                                                           │
│ Input:  CST + imported modules                                          │
│ Output: Bound AST + Symbol Table + Style Table + Diagnostics            │
│ • Resolves @import (loads dependencies)                                 │
│ • Creates symbol table for @define macros                               │
│ • Links @use → @define, validates arity                                 │
│ • Detects: undefined macros, cycles, arity mismatches                   │
│ • NO EXPANSION - just linking                                           │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: EVALUATE                                                       │
│ Input:  Bound AST + Symbol Table + Context (variables)                  │
│ Output: Document IR (Content Tree)                                      │
│ • Expands @use → inlines macro body                                     │
│ • Evaluates @if → keeps/discards branches                               │
│ • Expands @foreach/@repeat → generates iterations                       │
│ • Resolves {{ expressions }}                                            │
│ • Result: NO DIRECTIVES REMAIN - only content                           │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: STYLE                                                          │
│ Input:  Document IR + Style Table + Default Styles                      │
│ Output: Styled Document                                                 │
│ • Resolves StyleRef → concrete style properties                         │
│ • Applies style inheritance/cascading                                   │
│ • Computes final fonts, colors, spacing                                 │
│ • Every node has CONCRETE style, not references                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: EMIT                                                           │
│ Input:  Styled Document                                                 │
│ Output: DOCX (or PDF, HTML, etc.)                                       │
│ • Format-agnostic Document IR → format-specific output                  │
│ • Creates DOCX structures (styles.xml, document.xml, etc.)              │
│ • Could have multiple emitters: DocxEmitter, HtmlEmitter                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
src/
├── index.ts                 # Public API exports
├── types/                   # Shared type definitions
│   ├── cst.ts              # Concrete Syntax Tree types
│   ├── ast.ts              # Bound AST types
│   ├── symbols.ts          # Symbol table types
│   ├── document-ir.ts      # Document IR types (the key abstraction)
│   ├── styled.ts           # Styled document types
│   └── diagnostics.ts      # Error/warning types
├── parse/                   # Phase 1: PARSE
│   ├── index.ts            # parse(source) → CST
│   ├── lexer.ts            # Tokenizer
│   ├── parser.ts           # CST parser
│   └── tokens.ts           # Token types
├── bind/                    # Phase 2: BIND
│   ├── index.ts            # bind(cst) → BoundAST + Symbols
│   ├── binder.ts           # Main binding logic
│   ├── resolver.ts         # Import resolution
│   └── validator.ts        # Arity, cycle detection
├── evaluate/                # Phase 3: EVALUATE
│   ├── index.ts            # evaluate(bound, context) → DocumentIR
│   ├── evaluator.ts        # Main evaluation logic
│   ├── expander.ts         # Macro expansion
│   ├── control-flow.ts     # @if/@foreach/@repeat
│   └── expressions.ts      # Expression evaluation
├── style/                   # Phase 4: STYLE
│   ├── index.ts            # style(doc, styles) → StyledDocument
│   ├── resolver.ts         # Style resolution
│   ├── cascade.ts          # Inheritance logic
│   └── defaults.ts         # Default styles
├── emit/                    # Phase 5: EMIT
│   ├── index.ts            # emit(styled, format) → Buffer
│   ├── docx/               # DOCX emitter
│   │   ├── index.ts
│   │   ├── document.ts
│   │   ├── styles.ts
│   │   ├── numbering.ts
│   │   └── relationships.ts
│   └── html/               # Future: HTML emitter
├── pipeline/                # Pipeline orchestration
│   ├── index.ts            # compile(source, options) → Result
│   └── debug.ts            # Debug/inspection utilities
├── cli/                     # CLI interface
│   └── index.ts
├── lsp/                     # Language Server Protocol
│   └── ...                 # (port from src.bak/lsp later)
└── shared/                  # Utilities
    ├── units.ts            # Twips, points, inches
    ├── colors.ts           # Color handling
    └── source-location.ts  # Source tracking
```

---

## Implementation Phases

### Phase 1: Foundation (Types + Parse)

**Goal**: Define all IR types and implement the parser.

**Reference**:

- `src.bak/parser/` - existing lexer/parser logic
- `tests.bak/parser.test.ts` - existing parser tests

**Deliverables**:

1. `src/types/*.ts` - All type definitions (CST, AST, DocumentIR, etc.)
2. `src/parse/` - Lexer and parser producing CST
3. `tests/parse.test.ts` - Parser tests (port from tests.bak)

**Regression Check**:

- [ ] CST can represent all LDOC syntax

**Deferred**:

- LSP integration (Phase 6)
- Formatter (Phase 6)

**Journal**: Update `DEFERRED-JOURNAL.md` with any deferred items, regressions, or decisions.

---

### Phase 2: Binding

**Goal**: Implement name resolution and symbol table construction.

**Reference**:

- `src.bak/compiler/expansion/expander.ts` - macro resolution logic
- `src.bak/import/resolver.ts` - import handling

**Deliverables**:

1. `src/bind/` - Binder producing Symbol Table
2. `tests/bind.test.ts` - Binding tests

**Regression Check**:

- [ ] @define macros are indexed
- [ ] @use references are linked
- [ ] @import files are loaded and bound
- [ ] Undefined macro errors are caught
- [ ] Cycle detection works

**Deferred**:

- Style binding (moved to Phase 4 prep)

**Journal**: Update `DEFERRED-JOURNAL.md` with any deferred items, regressions, or decisions.

---

### Phase 3: Evaluation

**Goal**: Expand macros and evaluate control flow, producing Document IR.

**Reference**:

- `src.bak/compiler/expansion/expander.ts` - expansion logic
- `src.bak/compiler/expansion/control-flow.ts` - @if/@foreach
- `src.bak/compiler/conditions.ts` - expression evaluation

**Deliverables**:

1. `src/evaluate/` - Evaluator producing Document IR
2. `tests/evaluate.test.ts` - Evaluation tests

**Regression Check**:

- [ ] @use expands correctly with parameters
- [ ] @if branches correctly based on conditions
- [ ] @foreach iterates correctly
- [ ] @repeat generates correct iterations
- [ ] Nested macros work
- [ ] Variables are substituted

**Deferred**:

- Complex expression features (filters, etc.) - document and implement incrementally

**Journal**: Update `DEFERRED-JOURNAL.md` with any deferred items, regressions, or decisions.

---

### Phase 4: Styling

**Goal**: Resolve style references to concrete values.

**Reference**:

- `src.bak/compiler/styles.ts` - style handling
- `src.bak/shared/style-types.ts` - style type definitions

**Deliverables**:

1. `src/style/` - Style resolver
2. `tests/style.test.ts` - Style tests

**Regression Check**:

- [ ] @style definitions are applied
- [ ] Style inheritance works
- [ ] Default styles are applied
- [ ] All style properties resolve to concrete values

**Deferred**:

- Complex style features (document in journal)

**Journal**: Update `DEFERRED-JOURNAL.md` with any deferred items, regressions, or decisions.

---

### Phase 5: Emission

**Goal**: Transform Styled Document to DOCX.

**Reference**:

- `src.bak/compiler/visitors/docx-visitor.ts` - DOCX generation
- `src.bak/compiler/visitors/inline-visitor.ts` - inline handling
- `src.bak/compiler/table.ts` - table generation
- `src.bak/compiler/numbering.ts` - list numbering
- `src.bak/compiler/section-builder.ts` - sections

**Deliverables**:

1. `src/emit/docx/` - DOCX emitter
2. `tests/emit.test.ts` - Emission tests
3. Integration tests that compile full documents

**Regression Check**:

- [ ] Simple paragraphs render
- [ ] Headings render with correct styles
- [ ] Tables render correctly
- [ ] Lists render with numbering
- [ ] Images embed correctly
- [ ] Page breaks work
- [ ] Headers/footers work
- [ ] Footnotes work

**Deferred**:

- HTML emitter (future)
- PDF emitter (future)

**Journal**: Update `DEFERRED-JOURNAL.md` with any deferred items, regressions, or decisions.

---

### Phase 6: Integration

**Goal**: Wire everything together, port CLI, LSP, decompiler integration.

**Reference**:

- `src.bak/cli/index.ts` - CLI
- `src.bak/lsp/` - LSP server
- `src.bak/decompiler/` - Decompiler (mostly keep as-is)
- `src.bak/formatter/` - Formatter

**Deliverables**:

1. `src/cli/` - CLI using new pipeline
2. `src/lsp/` - LSP using new parser/binder
3. Port decompiler to use new types where needed
4. Formatter using new CST

**Regression Check**:

- [ ] `ldoc compile` works
- [ ] `ldoc decompile` works
- [ ] LSP provides completions
- [ ] All fidelity tests pass

**Journal**: Final review of `DEFERRED-JOURNAL.md` - all critical items should be resolved.

---

## Deferred Work Journal

Track items deferred to later phases:

| Item                                 | Deferred From | Deferred To | Reason |
| ------------------------------------ | ------------- | ----------- | ------ |
| (to be filled during implementation) |               |             |        |

---

## Verification Protocol

After each phase:

1. **Run new tests**: `bun test`
2. **Compare with old**: Check behavior against `src.bak` implementation
3. **Document regressions**: If something doesn't work, document whether:
   - It's a known limitation to fix in a later phase
   - It's a bug that needs fixing now
   - It's a deliberate simplification
4. **Update journal**: Add any deferred work

---

## Ground Rules for Implementation

1. **Reference src.bak liberally** - The old code has edge cases we need
2. **But don't copy blindly** - Understand, then reimplement cleanly
3. **Types first** - Define the IR types before implementing transforms
4. **Test as you go** - Each phase should have tests before moving on
5. **Document decisions** - Why did we do X instead of Y?
6. **Inspect IRs** - Add debug output at each phase boundary
7. **No premature optimization** - Get it correct first

---

## MANDATORY: Journaling Protocol

**You MUST maintain `DEFERRED-JOURNAL.md` throughout implementation.**

After EVERY work session:

1. **Log deferred items**: If you encounter something that should wait for a later phase, add it to the journal with:
   - What was deferred
   - Which phase encountered it
   - Which phase will handle it
   - Why it's being deferred
   - Severity (Critical/Important/Nice-to-have)

2. **Log regressions**: If tests fail or features don't work:
   - Is this temporary? (Will be fixed in phase N)
   - Is this a bug? (Fix now)
   - Is this deliberate? (Document why)

3. **Log decisions**: Architectural choices, trade-offs, questions

4. **Review before starting**: Read the journal before each session to understand context

**The journal is the source of truth for what's left to do.**

---

## Success Criteria

The rewrite is complete when:

1. All existing tests pass (ported from tests.bak)
2. Fidelity tests pass (DOCX roundtrip)
3. Each phase is independently testable
4. Debug inspection works at every phase boundary
5. Code is understandable without comments
6. Deferred work journal has no critical items

---

## Commands

```bash
# Run tests
bun test tests/

# Run specific phase tests
bun test tests/parse.test.ts
bun test tests/bind.test.ts
bun test tests/evaluate.test.ts
bun test tests/style.test.ts
bun test tests/emit.test.ts

# Typecheck
bunx tsc -p tsconfig.json

# Run CLI (once implemented)
bun run src/cli/index.ts compile input.ldoc -o output.docx

# Compare with old implementation
bun run src.bak/cli/index.ts compile input.ldoc -o old.docx
```

---

## Let's Begin

Phase 1 starts now. First deliverable: `src/types/*.ts`
