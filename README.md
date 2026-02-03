# ldoc - Legal Document DSL

A lightweight markup language for legal documents that compiles to DOCX.

## Features

- **Explicit structure** — No detection or guessing
- **Nested numbered lists** — `@1`, `@@a`, `@@@i`, `@@@@A`
- **Multiple numbering styles** — Decimal, alpha, roman, hierarchical (`1.1.`)
- **Modifiers** — `@center`, `@bold`, `@indent`, etc.
- **Variables** — `{{seller}}`, `{{property.address}}`
- **Cross-references** — `[[Section 5.2]]`, `[[Exhibit A]]`
- **Tables** — Simple bracket syntax
- **Compiles to DOCX** — Properly formatted with styles

## Spec Checklist

This is a running checklist derived from `legal-dsl-spec.md`.

### Syntax & Core Structure

- [x] `@document <Title>`
- [x] Markdown headers: `#`, `##`, `###`
- [x] `@meta` block (nested keys)
- [x] Comments: `//` and `/* ... */`
- [x] `@todo` comments
- [x] `.ldoc` file extension

### Modifiers (Formatting)

- [x] Alignment: `@center`, `@right`
- [x] `@indent` (Indent block paragraphs)
- [ ] `@box` (Missing: parsed, DOCX output not implemented)
- [x] Text styles: `@bold`, `@italic`, `@small`, `@caps`
- [x] Chaining/nesting: `@center @bold ...` and indented blocks

### Lists & Numbering

- [x] Nesting depth via `@` count: `@`, `@@`, `@@@`, ...
- [x] Decimal styles: `@1`, `@@2.1`, ...
- [x] Alpha styles: `@@a`, `@@@@A`, ...
- [x] Roman styles: `@@@i`, `@@@I`, ...
- [x] Bullets: `@-`, `@@-`, ...
- [x] Continuation paragraphs inside items (indentation)
- [ ] `@numbering ...` defaults (Missing)

### Inline Features

- [x] Variables: `{{var}}`, `{{nested.path}}`
- [x] Filters: `{{var | upper}}`, `lower`, `capitalize`
- [x] Defined terms: first-use formatting for `"Term"`
- [ ] Cross-reference validation + real links/fields (Partial: `[[...]]` renders as text)
- [x] Blanks: `___` and longer underscore runs
- [x] Emphasis: `*italic*`, `**bold**`, `***both***`

### Tables

- [x] `@table` + row syntax `[a, b, c]`
- [x] First row treated as header
- [x] Quoted cell values for commas
- [ ] Table styling/modifiers (Partial: basic table output only)

### Page & Layout

- [x] `@pagebreak`
- [ ] Headers/footers: `@header`, `@footer`, `@firstpage` (Missing)
- [ ] `@margins` (Missing)
- [ ] `@spacing` (Missing)
- [ ] `@landscape` (Missing)
- [ ] `@columns` (Missing)

### Templates, Imports, Control Flow

- [ ] `@import` resolution/loading (Partial: parsed only)
- [ ] `@define name(params)` (Missing)
- [ ] `@params` / `@template` blocks (Missing)
- [ ] `@if` / `@else` / `@end` (Missing)
- [ ] `@repeat` (Missing)

### Tooling

- [x] CLI: `compile`, `parse`, `watch`
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

### Watch mode

```bash
bun run ldoc watch document.ldoc
```

### Parse (debug)

```bash
bun run ldoc parse document.ldoc --json
```

## Syntax

### Document structure

```ldoc
@document Real Estate Purchase Agreement

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

## Neovim Setup

### Vim syntax (no build required)

```bash
# Copy to your Neovim config
cp -r vim/* ~/.config/nvim/
```

### Tree-sitter (optional)

```bash
cd tree-sitter-ldoc
npm install
npx tree-sitter generate
```

Then add to your Neovim tree-sitter config.

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
