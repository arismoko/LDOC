# Tree-sitter LDOC Status

## Current State ✅

All 11 tree-sitter tests pass. The grammar covers the main LDOC syntax for syntax highlighting.

## Features

### Syntax Highlighting - COMPLETE
- All directives (`@document`, `@meta`, `@define`, `@use`, `@if`, `@foreach`, etc.)
- Inline formatting (bold, italic, strikethrough, code)
- Variables `{{name}}` and cross-references `[[target]]`
- Tables, lists, headers, modifiers
- Comments (line `//`, block `/* */`, todo `@todo`)

### Invalid Variable Detection - COMPLETE
- Single-brace `{page}` now highlights as `@error` instead of generic ERROR
- Provides clear visual feedback that `{{page}}` is required

### Variable Scoping (locals.scm) - COMPLETE
- `@local.scope` for `@define`, `@foreach`, `@if`, `@repeat` blocks
- `@local.definition` for `@set`, `@define`, parameters, loop variables
- `@local.reference` for `{{variable}}`, `@use`, identifiers

### Code Folding (folds.scm) - COMPLETE
- All block constructs fold correctly

### Indentation (indents.scm) - COMPLETE
- Proper indent/dedent for blocks

## Known Limitations (Won't Fix)

### Nested emphasis in tree-sitter
- **Issue**: `**bold with *italic* inside**` doesn't highlight nested parts
- **Reason**: Tree-sitter doesn't support lookahead; would require external scanner
- **Workaround**: TypeScript parser handles this correctly for actual parsing
- **Impact**: Low - basic emphasis works, nesting is rare in legal documents

## Testing

```bash
cd tree-sitter-ldoc
tree-sitter generate
tree-sitter test        # 11/11 tests pass
```

## Neovim Integration

Parser and queries are installed to:
- `~/.local/share/nvim/site/parser/ldoc.so`
- `~/.local/share/nvim/site/queries/ldoc/*.scm`

To refresh after changes:
```bash
cp tree-sitter-ldoc/ldoc.so ~/.local/share/nvim/site/parser/
cp tree-sitter-ldoc/queries/*.scm ~/.local/share/nvim/site/queries/ldoc/
```
