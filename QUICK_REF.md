# LDOC Quick Reference

> **Full Documentation:** See [docs/index.md](docs/index.md)

## Structure
```ldoc
@document
  title: My Doc
  margins: 1in
  numbering: default

@import legal-blocks
@meta
  date: 2026-02-15
  parties:
    seller: Acme Corp
```

## Headers & Text
```ldoc
# Heading 1
## Heading 2

Paragraph text with **bold**, *italic*, ~~strike~~, `code`.
Link: [Text](url)
Variable: {{parties.seller}}
```

## Lists
```ldoc
@1 Decimal (1., 1.1.)
@@a Alpha (a, b)
@@@i Roman (i, ii)
@@@@A Upper Alpha (A, B)

@- Bullet
@@- Nested Bullet
```

## Modifiers
```ldoc
@center Centered Text
@right Right Aligned
@bold Bold Block

@indent:2
  Indented block (1 inch)
```

## Tables
```ldoc
@table
  [Header 1, Header 2]
  [Cell 1,   Cell 2]
  [Colspan >, Cell 3]
  [Rowspan ^, Cell 4]
```

## Control Flow
```ldoc
@if condition
  Show this
@elseif other
  Show that
@else
  Show default
@end

@foreach item in items
  {{item.name}}
@end

@set count = count + 1
```

## Macros
```ldoc
@define my_block(param)
  Hello {{param}}

@use my_block(param="World")
```
