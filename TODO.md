# LDOC Known Limitations & Future Work

## Parser Limitations

### Bold Inside Italic (Lexer-Level)

The pattern `*italic **bold** italic*` does not parse correctly. The lexer consumes the first `*` greedily and cannot determine it's meant to be paired with the final `*`.

**Workaround:** Use the outer style first:
```ldoc
**bold *italic* bold**  // Works: bold containing italic
*italic* **bold** *italic*  // Works: separate spans
```

**Root cause:** The lexer tokenizes `*` characters before the parser can analyze nesting. A potential fix would require look-ahead in the lexer or a different inline parsing strategy.

### Nested Emphasis in Tree-sitter

The tree-sitter grammar (`tree-sitter-ldoc/`) does not support nested emphasis like `**bold *italic* bold**`. The TypeScript parser handles this correctly; tree-sitter is for syntax highlighting only.

## Decompiler Limitations

### Lossy Conversion

DOCX-to-LDOC conversion is inherently lossy:
- Complex tables with merged cells may not round-trip perfectly
- Some Word styles don't map to LDOC constructs
- Embedded objects (charts, SmartArt) are skipped
- Complex nested structures may simplify

### Image Extraction

Images are extracted to `media/` with generic names (`image1.png`, etc.). Original filenames from Word are not preserved.

## LSP Limitations

### Cross-File Resolution

- `@import` paths are resolved relative to the current file
- Circular imports are detected but error messages could be clearer
- Renaming across files is not yet supported

### Strict Mode

By default, the LSP reports warnings for undefined variables. This can be noisy for templates with external data. A `strict: false` option in `@document` could be added in the future.

## Tree-sitter

### Highlight-Only

The tree-sitter parser is for syntax highlighting only. All actual parsing, validation, and compilation uses the TypeScript parser.

### Single-Brace Variables

`{page}` (single brace) now highlights as `@error` to catch typos. Valid variables use double braces: `{{page}}`.

## Future Improvements

- [ ] Better error recovery in parser (continue after errors)
- [ ] Incremental parsing for large documents
- [ ] Table cell alignment syntax
- [ ] Image sizing/positioning options
- [ ] PDF output (via DOCX intermediate)
- [ ] Multi-file project compilation
- [ ] Variable type annotations in `@meta`
