# ldoc - Legal Document DSL

A lightweight markup language for legal documents that compiles to DOCX.

## Features

- **Explicit structure** — No detection or guessing
- **Nested numbered lists** — `@1`, `@@a`, `@@@i`, `@@@@A`
- **Multiple numbering styles** — Decimal, alpha, roman, hierarchical (`1.1.`)
- **Modifiers** — `@center`, `@bold`, `@indent`, etc.
- **Style customization** — `@document` block (`styles: ...`)
- **Variables** — `{{seller}}`, `{{property.address}}`
- **Cross-references** — `[[Section 5.2]]`, `[[Exhibit A]]`
- **Tables** — Simple bracket syntax
- **Compiles to DOCX** — Properly formatted with styles

## Spec Checklist

This is a running checklist derived from `legal-dsl-spec.md`.

### Syntax & Core Structure

- [x] `@document` (block metadata/settings; does not auto-render)

Notes:
- `@document` must be a block (indented key/value). Inline `@document <Title>` is intentionally not supported.
- [x] Markdown headers: `#`, `##`, `###`
- [x] `@meta` block (nested keys)
- [x] Comments: `//` and `/* ... */`
- [x] `@todo` comments
- [x] `.ldoc` file extension

### Modifiers (Formatting)

- [x] Alignment: `@center`, `@right`
- [x] `@indent` (Indent block paragraphs)
- [x] `@outdent` (Outdent block paragraphs)
- [x] `@box` (Bordered box)
- [x] Text styles: `@bold`, `@italic`, `@small`, `@caps`
- [x] Chaining/nesting: `@center @bold ...` and indented blocks

### Lists & Numbering

- [x] Nesting depth via `@` count: `@`, `@@`, `@@@`, ...
- [x] Decimal styles: `@1`, `@@2.1`, ...
- [x] Alpha styles: `@@a`, `@@@@A`, ...
- [x] Roman styles: `@@@i`, `@@@I`, ...
- [x] Bullets: `@-`, `@@-`, ...
- [x] Continuation paragraphs inside items (indentation)
- [x] `@document` numbering scheme

### Inline Features

- [x] Variables: `{{var}}`, `{{nested.path}}`
- [x] Filters: `{{var | upper}}`, `lower`, `capitalize`
- [x] Defined terms: first-use formatting for `"Term"`
- [x] Cross-reference validation + real links/fields (`[[...]]` -> internal DOCX hyperlink; fails compile if missing)
- [x] Blanks: `___` and longer underscore runs
- [x] Emphasis: `*italic*`, `**bold**`, `***both***`

### Tables

- [x] `@table` + row syntax `[a, b, c]`
- [x] Complex tables: `>` for colspan, `^` for rowspan
- [x] First row treated as header
- [x] Quoted cell values for commas
- [x] Table styling (legal grid: thin borders, light gray header shading, cell padding, auto-fit columns)

### Page & Layout

- [x] `@pagebreak`
- [x] Headers/footers: `@header`, `@footer`, `@firstpage`
- [x] `@document` layout (margins, spacing, page_size, orientation)
- [x] `@columns` region blocks (multi-column sections, closed with `@end`)
  - Top-level: Native Word columns (Section Breaks)
  - Nested: Rendered as invisible tables (for complex layouts)

### Templates, Imports, Control Flow

- [x] `@import` resolution/loading
- [x] `@define name(params)` template definitions
- [x] `@use name(args)` template expansion
- [x] `@if` / `@else` / `@end` conditionals
- [x] `@repeat` count-based loops
- [x] `@foreach item in iterable` iteration
- [x] `@set variable = expression` data manipulation

### Tooling

- [x] CLI: `compile`, `parse`, `watch`, `validate`, `fmt`
- [ ] LSP: autocomplete/diagnostics/navigation (Missing)

### Round-trip

- [ ] DOCX -> `.ldoc` conversion (Missing)

## Installation

```bash
bun install
```

## Usage

### Compile to DOCX

```bash
bun run ldoc compile document.ldoc
bun run ldoc compile document.ldoc -o output.docx
```

### Decompile

Convert DOCX back to LDOC:

```bash
bun run ldoc decompile document.docx -o source.ldoc
```

This will:
1. Create `source.ldoc`.
2. Extract images to `media/` (relative to the output file).
3. Emit `![alt](media/image.png)` in the LDOC source.
4. Convert bookmarks to `@anchor Name`.

### Watch mode

```bash
bun run ldoc watch document.ldoc
```

### Format

Auto-format LDOC files (indentation, table alignment):

```bash
# Output to stdout (uses tabs by default)
bun run ldoc fmt document.ldoc

# Overwrite file
bun run ldoc fmt document.ldoc -w

# Use 2 spaces instead of tabs for indentation
bun run ldoc fmt document.ldoc --spaces
```

### Diff

Compare two LDOC files semantically (ignoring whitespace/formatting differences):

```bash
# Human-readable color diff
bun run ldoc diff fileA.ldoc fileB.ldoc

# JSON output (for agents)
bun run ldoc diff fileA.ldoc fileB.ldoc --json
```

### Parse (debug)

```bash
bun run ldoc parse document.ldoc --json
```

## Syntax

### Document structure

```ldoc
@document
  title: Real Estate Purchase Agreement
  short_title: Purchase Agreement

@meta
  date: February 15, 2026
  parties:
    seller: ACME Corp
    buyer: John Doe

@center
  # Real Estate Purchase Agreement

THIS AGREEMENT is made between {{parties.seller}} ("Seller") 
and {{parties.buyer}} ("Buyer").
```

### Numbered lists

```ldoc
@1 Agreement of Sale.
Seller agrees to sell:

@@a the building (the "Improvements");
@@b all contracts (the "Assumed Contracts");
@@c personal property per [[Exhibit B]].

@2 Purchase Price.
One million dollars, payable:

@@2.1 Earnest money of $10,000.
@@2.2 Balance at Closing.

@3 Representations.

@@a Seller represents:
@@@i no litigation pending;
@@@ii no liens exist;
@@@iii authority to sell.
```

### Modifiers

```ldoc
@center # EXHIBIT A

@center @bold NOTICE

@box
  Important information here.
  Multiple lines supported.
```

### Bullet lists

```ldoc
@- Kitchen equipment
@@- Stove
@@- Refrigerator
@- Office equipment
```

### Tables

```ldoc
@table
  [Item, Seller Pays, Buyer Pays]
  [Title Insurance, X, ""]
  [Recording Fee, "", X]
  [Escrow Fee, 1/2, 1/2]
```

### Variables

```ldoc
@meta
  parties:
    seller: ACME Corp

This Agreement is between {{parties.seller}} (the "Seller").
```

### Cross-references

```ldoc
As described in [[Section 5.2]], subject to [[Exhibit A]].
```

### Style customization

```ldoc
@document
  styles:
    body:
      font: Georgia
      size: 11pt
    heading1:
      font: Helvetica
      size: 24pt
    header:
      font: Arial
      size: 9pt
```

**Supported targets:** `body`, `heading`, `heading1`..`heading6`, `header`, `footer`

**Supported keys:** `font`, `size` (pt), `bold`, `italic`, `color` (#RRGGBB)

**Note:** document-wide options must be configured in `@document` (standalone `@margins/@spacing/@landscape/@numbering/@styles` are errors).

## Neovim Setup

### Tree-sitter

```bash
cd tree-sitter-ldoc
bun install
bun run generate
```

Then configure Neovim Tree-sitter + LSP; see `EDITORS.md`.

## File Extension

`.ldoc` (legal document)

## Development

```bash
# Run tests
bun test

# Compile example
bun run ldoc compile examples/purchase-agreement.ldoc
```

## License

MIT
