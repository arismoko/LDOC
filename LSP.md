# LSP Port Plan

## Prerequisites

**This plan depends on error-tolerant parsing.**

See `ERROR-RECOVERY.md` for the parser enhancement plan. The LSP implementation should begin after Phase 3 (Local Recovery - Delimiters) of error recovery is complete, as that provides the `incomplete` flag needed for smart completions.

---

## Mission Statement

Port the Language Server Protocol implementation to the new compiler architecture with:

- **Simplicity**: Leverage `SymbolTable` from binder instead of building separate index
- **Precision**: Clean position mapping between LSP and CST coordinates
- **Minimal Code**: Delete redundant modules, merge related functionality

---

## Architecture: Old vs New

### Old Architecture (src.bak/lsp/)

```
Parser (AST) → indexer.ts (builds DocumentIndex) → server.ts → LSP
                                                 ↓
                                          completion.ts
                                          references.ts
                                          workspace.ts
```

- Parser produced AST nodes: `DefineNode`, `AnchorNode`, `UseNode`, etc.
- LSP built its own index by walking AST
- Completion context detected by analyzing AST node types
- ~1560 lines across 5 files

### New Architecture (src/lsp/)

```
parseAndBind(source)
     ↓
{ cst, symbols, diagnostics }
     ↓
server.ts → LSP
     ↓
completion.ts / navigation.ts
```

- Parser produces CST with source locations
- Binder creates `SymbolTable` with macros, styles, anchors, variables, footnotes
- Each symbol has `usages: SourceLocation[]` already tracked
- Pipeline: `parseAndBind(source)` returns everything LSP needs

### Key Insight

The `SymbolTable` already tracks:
- `macros: Map<string, MacroSymbol>` with `usages[]`
- `anchors: Map<string, AnchorSymbol>` with `usages[]`
- `variables: Map<string, VariableSymbol>` with `usages[]`
- `footnotes: Map<string, FootnoteSymbol>` with `usages[]`
- `styles: Map<string, StyleSymbol>` with `usages[]`

**This eliminates the need for a separate indexer!**

---

## Directory Structure

```
src/lsp/
├── index.ts            # Public exports + startServer()
├── server.ts           # Main LSP server, document management
├── completion.ts       # Completion provider (context detection + items)
├── navigation.ts       # Go-to-definition + Find references (combined)
├── position.ts         # Position conversion utilities
└── diagnostics.ts      # Diagnostic conversion to LSP format
```

---

## File Mapping: Old → New

| Old File        | Lines | Action                                  | New Lines |
| --------------- | ----- | --------------------------------------- | --------- |
| `indexer.ts`    | 182   | **DELETE** - Binder provides SymbolTable | 0         |
| `workspace.ts`  | 167   | **DELETE** - Use ImportResolver          | 0         |
| `references.ts` | 88    | **MERGE** into navigation.ts             | -         |
| `server.ts`     | 514   | **SIMPLIFY** - Use parseAndBind()        | ~200      |
| `completion.ts` | 609   | **PORT** - Update to use SymbolTable     | ~400      |
| *position.ts*   | -     | **NEW** - Position utilities             | ~60       |
| *diagnostics.ts*| -     | **NEW** - Diagnostic conversion          | ~30       |
| *navigation.ts* | -     | **NEW** - Go-to-def + find-refs          | ~150      |

**Old: ~1560 lines → New: ~840 lines (46% reduction)**

---

## Implementation Phases

### Phase 1: Foundation

**Goal**: Position conversion and diagnostic mapping utilities.

**Deliverables**:
1. `src/lsp/position.ts` - LSP ↔ SourceLocation conversion
2. `src/lsp/diagnostics.ts` - Diagnostic[] → LSP Diagnostic[]
3. Unit tests for position edge cases

**Key Types**:
```typescript
// SourceLocation: 1-based line, 0-based column
// LSP Position: 0-based line, 0-based character

function sourceLocationToRange(loc: SourceLocation): Range;
function positionInLocation(pos: Position, loc: SourceLocation): boolean;
function positionToOffset(text: string, pos: Position): number;
```

**Estimated Effort**: 4 hours

---

### Phase 2: Navigation

**Goal**: Go-to-definition and find-references using SymbolTable.

**Deliverables**:
1. `src/lsp/navigation.ts` - Combined navigation provider
2. Integration tests

**Key Functions**:
```typescript
function getDefinition(ctx: DocumentContext, text: string, pos: Position): Location | null;
function getReferences(ctx: DocumentContext, text: string, pos: Position, includeDecl: boolean): Location[];
function findNodeAtPosition(cst: CSTDocument, pos: Position): CSTNode | null;
```

**Key Pattern - CST Walking**:
```typescript
function* walkCst(node: CSTNode): Generator<CSTNode> {
  yield node;
  for (const child of getChildren(node)) {
    yield* walkCst(child);
  }
}
```

**Estimated Effort**: 6 hours

---

### Phase 3: Completion

**Goal**: CST-based completion with `incomplete` flag detection.

**Reference**: `src.bak/lsp/completion.ts`

**Deliverables**:
1. `src/lsp/completion.ts` - CST-based context detection + completion items
2. Tests for all completion contexts

**Completion Contexts**:
- `directive` - After `@` at line start
- `macro_name` - After `@use(`
- `macro_param_key` - Inside `@use(name, |)`
- `variable` - Inside `{{|}}`
- `variable_filter` - After `{{var |`
- `cross_ref` - After `@ref(`
- `footnote_ref` - After `[^`
- `style_name` - After `@style(`

**Key Pattern - Using `incomplete` flag**:

```typescript
function getCompletionContext(cst: CSTDocument, position: Position): CompletionContext {
  const node = findNodeAtPosition(cst, position);
  if (!node) return { kind: "none", prefix: "" };

  // Check for incomplete nodes - these are completion opportunities
  if ("incomplete" in node && node.incomplete) {
    return contextFromIncompleteNode(node, position);
  }

  // Walk up to find containing context
  return contextFromAncestors(node, position);
}

function contextFromIncompleteNode(node: CSTNode): CompletionContext {
  const missing = node.incomplete?.missing[0];
  if (!missing) return { kind: "none", prefix: "" };

  if (node.type === "Directive") {
    if (node.name === "use") {
      // Inside @use( - offer macro names or params
      return { kind: "macro_name", prefix: getPartialName(node) };
    }
    if (node.name === "ref") {
      return { kind: "cross_ref", prefix: getPartialRef(node) };
    }
  }

  if (node.type === "Variable") {
    const expr = node.expression;
    if (expr.includes("|")) {
      return { kind: "variable_filter", prefix: expr.split("|").pop()?.trim() ?? "" };
    }
    return { kind: "variable", prefix: expr.trim() };
  }

  if (node.type === "FootnoteRef") {
    return { kind: "footnote_ref", prefix: node.label };
  }

  return { kind: "none", prefix: "" };
}
```

**Estimated Effort**: 8 hours

---

### Phase 4: Server Integration

**Goal**: Wire everything together.

**Reference**: `src.bak/lsp/server.ts`

**Deliverables**:
1. `src/lsp/server.ts` - Main server with simplified cache
2. `src/lsp/index.ts` - Exports
3. E2E tests

**Server Pattern**:
```typescript
const cache = new Map<string, { cst: CSTDocument; symbols: SymbolTable }>();

documents.onDidChangeContent((change) => {
  const { cst, symbols, diagnostics } = parseAndBind(change.document.getText());
  cache.set(change.document.uri, { cst, symbols });
  connection.sendDiagnostics({ uri, diagnostics: toLspDiagnostics(diagnostics) });
});
```

**Estimated Effort**: 6 hours

---

### Phase 5: Cross-file Support

**Goal**: Handle `@import` with ImportResolver.

**Deliverables**:
1. Async validation for documents with imports
2. Cross-file go-to-definition
3. Multi-file symbol resolution

**Pattern**:
```typescript
// Use async bind() when imports detected
const bindResult = await bind(cst, {
  sourcePath: filePath,
  loadFile: async (path) => parseSource(await Bun.file(path).text()),
});
```

**Estimated Effort**: 8 hours

---

## Risk Assessment

### Low Risk
- Position conversion - Well-defined mapping
- Diagnostics conversion - Simple translation
- Go-to-definition for macros - SymbolTable has everything

### Medium Risk
- **Completion context detection**: Regex-based approach may miss edge cases
  - *Mitigation*: Keep text-based approach, enhance with CST later if needed

- **Cross-file resolution**: New ImportResolver is async, old LSP was sync
  - *Mitigation*: Use async validation only when imports detected

### Higher Risk
- **Variable completion**: Old code tracked `@foreach` loop variables separately
  - *Mitigation*: May need to enhance Binder to collect loop variables

- **Performance**: Re-parsing on every keystroke
  - *Mitigation*: Parser is fast; add version caching later if needed

---

## Verification Protocol

After each phase:

1. **Run unit tests**: `bun test tests/lsp/`
2. **Typecheck**: `bunx tsc -p tsconfig.json`
3. **Manual testing**: Test in VSCode or Neovim
4. **Update journal**: Document decisions and issues

---

## Success Criteria

The LSP port is complete when:

1. All completion contexts work (macros, variables, anchors, footnotes)
2. Go-to-definition works for all symbol types
3. Find-references returns definition + all usages
4. Diagnostics appear in real-time
5. Cross-file @import resolution works
6. Manual testing passes in at least one editor

---

## Commands

```bash
# Run LSP tests
bun test tests/lsp/

# Start LSP server (for editor integration)
bun run src/lsp/index.ts

# Typecheck
bunx tsc -p tsconfig.json
```

---

## Let's Begin

Phase 1 starts now. First deliverable: `src/lsp/position.ts`
