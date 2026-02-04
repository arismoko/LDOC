# Tree-sitter LDOC TODO

## Known Grammar Limitations

These are edge cases that produce ERROR nodes but don't significantly impact syntax highlighting:

### 1. Single-brace variables in content
- **Issue**: `{page}` single braces produce errors (LDOC uses `{{page}}`)
- **Impact**: Low - text is still parsed, just with inline ERROR nodes
- **Fix**: Corpus files should use `{{page}}` instead of `{page}`

### 2. Nested emphasis
- **Issue**: `**bold with *nested italic* inside**` doesn't parse correctly
- **Impact**: Low - basic emphasis works, nesting is edge case
- **Fix**: Would require more complex grammar rules

### 3. ~~Links inside table cells~~ FIXED
- ~~**Issue**: `[Link text](url)` inside table `[cell, content]` conflicts~~
- **Status**: Fixed - `table_cell_content` now handles balanced brackets

### 4. Header/footer blocks with indented content
- **Issue**: Multi-line headers/footers with indented content
- **Impact**: Low - single-line form works, multi-line is less common
- **Fix**: Add indented_line handling similar to @document/@meta

## ~~Pending~~ Completed Features

### locals.scm (variable scoping) - DONE
- ✅ `@local.scope` for `@define`, `@foreach`, `@if`, `@repeat` blocks
- ✅ `@local.definition` for `@set`, `@define`, parameters, loop variables
- ✅ `@local.reference` for `{{variable}}`, `@use`, identifiers

### folds.scm - DONE
- Already exists and works with current block structure

### indents.scm - DONE  
- Already exists and works with current block structure

## Testing

Current test coverage:
- 11 basic tests passing
- Corpus files parse with some edge case errors (acceptable)

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
