# Tree-sitter LDOC Status

## Current State

All 11 tree-sitter tests pass. The grammar covers the main LDOC syntax for syntax highlighting purposes.

## Known Grammar Limitations (Low Priority)

These are edge cases that produce ERROR nodes but don't significantly impact syntax highlighting. The TypeScript parser handles all of these correctly.

### 1. Single-brace variables in content
- **Issue**: `{page}` single braces produce errors (LDOC uses `{{page}}`)
- **Impact**: Low - text is still parsed, just with inline ERROR nodes
- **Status**: Expected behavior - single braces are invalid in LDOC

### 2. Nested emphasis in tree-sitter
- **Issue**: `**bold with *nested italic* inside**` doesn't parse correctly in tree-sitter
- **Impact**: Low - basic emphasis works; the TypeScript parser handles nesting correctly
- **Status**: Tree-sitter limitation (would require lookahead)

### 3. ~~Links inside table cells~~ FIXED
- **Status**: Fixed - `table_cell_content` now handles balanced brackets

### 4. Header/footer blocks with indented content
- **Issue**: Multi-line headers/footers with indented content in tree-sitter
- **Impact**: Low - single-line form works; TypeScript parser handles multi-line correctly
- **Status**: Tree-sitter is for highlighting only; parser handles this

## Completed Features

### locals.scm (variable scoping) - DONE
- `@local.scope` for `@define`, `@foreach`, `@if`, `@repeat` blocks
- `@local.definition` for `@set`, `@define`, parameters, loop variables
- `@local.reference` for `{{variable}}`, `@use`, identifiers

### folds.scm - DONE
- Works with current block structure

### indents.scm - DONE
- Works with current block structure

### highlights.scm - DONE
- Full highlighting for all LDOC constructs

## Testing

Current test coverage:
- 11 tree-sitter tests passing (100%)
- TypeScript parser: 290 tests passing

To run tests:
```bash
cd tree-sitter-ldoc
tree-sitter generate
tree-sitter test
```

To test against corpus:
```bash
tree-sitter parse ../tests/corpus/structure.ldoc
```
