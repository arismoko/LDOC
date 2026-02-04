# LDOC Syntax Reference

This is the complete reference for LDOC (Legal Document DSL) syntax.

!!! tip
    LDOC is designed to be a superset of Markdown. Most standard Markdown features work out of the box.

---

## Document Structure

### `@document` Block

Defines global document settings. Must be at the top of the file.

```ldoc
@document
  title: My Document
  page_size: letter
  margins: "1in 1in 1in 1.25in"
```

!!! warning
    The `@document` block does not require an `@end` tag and MUST be the first block in your file (except for comments).

See [Document Settings](document.md) for the complete reference.

### `@meta` Block

Defines document variables and structured data.

```ldoc
@meta
  date: February 15, 2026
  parties:
    seller: { name: "ACME Corp" }
@end
```

!!! example "Usage"
    Access these variables anywhere in your text using double braces:
    `This agreement is dated {{date}}.`

---

## Headers

Markdown-style headers with `#` through `######`:

```ldoc
# Heading 1
## Heading 2
```

!!! info
    Headers automatically become cross-reference anchors. You can link to them using `[[Heading Text]]`.

---

## Lists

### Numbered Lists

Nesting depth is determined by the number of `@` symbols.

```ldoc
@1 First item
@@a Sub-item a
@@@i Sub-sub-item i
```

| Marker | Style | Output |
|--------|-------|--------|
| `@1` | Decimal | 1., 2., 3. |
| `@@a` | Lowercase alpha | (a), (b), (c) |
| `@@@i` | Lowercase roman | (i), (ii), (iii) |

!!! tip "Continuation Paragraphs"
    Indent content under a list item to include it in that item without breaking the list:
    ```ldoc
    @1 Purchase Price.
      The price shall be $500,000.
    ```

---

## Tables

LDOC uses a clean bracket-based syntax for tables.

```ldoc
@table
  [Header 1, Header 2]
  [Cell A1, Cell A2]
  [Cell B1, Cell B2]
```

!!! example "Merging Cells"
    - Use `>` to merge with the cell to the left (Colspan).
    - Use `^` to merge with the cell above (Rowspan).

---

## Control Flow

### Conditionals

```ldoc
@if price > 100000
  **HIGH VALUE TRANSACTION**
@else
  Standard Transaction
@end
```

### Loops

```ldoc
@foreach item in items
  - {{item.name}}
@end
```

---

## Macros

Macros allow you to define reusable components.

```ldoc
@define signature(name)
  ______________________
  {{name}}
@end

@use signature(name="John Doe")
```

!!! tip "Slots"
    Use `@slot` inside a macro definition to allow passing a block of content when using the macro.

---

## Layout & Formatting

### Alignment & Styles

```ldoc
@center @bold @caps THE TITLE
@right *Dated: {{date}}*
```

### Columns

```ldoc
@columns 2
  Left column content.
  @break
  Right column content.
@end
```

!!! info
    Columns are balanced automatically unless you use `@break` to force content into the next column.

---

## Page Layout

### Page Breaks

```ldoc
@pagebreak
```

### Headers and Footers

```ldoc
@header Page {{page}} of {{pages}}
@footer Confidential - {{title}}
```

!!! tip "First Page"
    Use `@firstpage @header` to define a different header for only the first page.

---

## Cross-References

```ldoc
See [[Important Section]] for details.
```

!!! info
    These become clickable hyperlinks in the final DOCX file.
