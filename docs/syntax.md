# LDOC Syntax Reference

## Document Structure

### `@document`
Defines document-level metadata and settings. Must be at the top of the file.

```ldoc
@document
  title: "My Document"
  author: "John Doe"
  margins: 1in
@end
```

### Headers and Footers
Global headers and footers.

```ldoc
@doc_header
  Confidential - {{page}}
@end

@doc_footer
  Page {{page}} of {{pages}}
@end
```

## Text Formatting

Standard Markdown syntax:
- `**Bold**` -> **Bold**
- `*Italic*` -> *Italic*
- `***Bold Italic***` -> ***Bold Italic***
- `~~Strikethrough~~` -> ~~Strikethrough~~
- `` `Code` `` -> `Code`

## Blocks

### Headers
```ldoc
# Heading 1
## Heading 2
### Heading 3
```

### Lists
```ldoc
@1 Numbered Item
@@a Nested Item (a, b, c)
@@@i Nested Item (i, ii, iii)

@- Bullet Item
@@- Nested Bullet
```

### Blockquotes
```ldoc
> This is a blockquote.
```

### Horizontal Rule
```ldoc
---
```

## Layout

### Columns
Create multi-column layouts.

```ldoc
@columns 2
  Left Column
  @break
  Right Column
@end
```

### Boxes
Create a boxed region (single-cell table).

```ldoc
@box
  Content inside a box.
@end
```

### Page Breaks
```ldoc
@page_break
```

### Alignment
```ldoc
@center
Centered text
@end

@right
Right-aligned text
@end
```

## Dynamic Content

### Variables
```ldoc
Hello {{name}}!
```

### Set Variables
```ldoc
@set name = "World"
```

### Conditionals
```ldoc
@if show_details
  Details here...
@else
  Summary only.
@end
```

### Loops
```ldoc
@foreach item in items
  - {{item.name}}: {{item.price}}
@end
```

### Macros
Define reusable snippets.

```ldoc
@define signature(name, title)
  Sincerely,
  
  {{name}}
  *{{title}}*
@end

@use signature("Alice", "CEO")
```

## Images and Links

### Images
```ldoc
![Alt Text](path/to/image.png)
```
Or with size:
```ldoc
@image path/to/image.png width=200 height=100
```

### Links
```ldoc
[Google](https://google.com)
```

### Anchors and Internal Links
```ldoc
@anchor my-section
...
See [Section](#my-section)
```

## Tables

LDOC uses a custom array-style syntax for tables to support complex features like colspans and rowspans.

```ldoc
@table
  [Header 1, Header 2]
  [Cell 1,   Cell 2]
  [Colspan >, Cell 3]
  [Rowspan ^, Cell 4]
```

- `>` merges with the cell to the left (colspan).
- `^` merges with the cell above (rowspan).

