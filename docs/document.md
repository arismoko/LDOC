# @document Block Reference

The `@document` block configures document-wide settings: layout, page size, margins, spacing, numbering, and styles.

!!! warning "Strict Placement"
    The `@document` block **must** appear at the absolute **top of the file**. Only comments and blank lines may precede it. If content appears before it, the compiler will ignore the block.

## Basic Structure

```ldoc
@document
  title: "Contract Agreement"
  page_size: letter
  orientation: portrait
  margins: "1in 1in 1in 1.25in"
  styles:
    body:
      font: Georgia
      size: 11pt
```

---

## Properties

### Metadata

| Property | Type | Description |
|----------|------|-------------|
| `title` | string | Document title (metadata only) |
| `author` | string | Document author |
| `short_title` | string | Short title for headers/footers |

!!! note
    The `title` property sets the metadata of the Word file. It does **not** render a visible heading in the document. You should still use a `# Heading` for that.

### Page Layout

| Property | Values | Default |
|----------|--------|---------|
| `page_size` | `letter`, `a4` | `letter` |
| `orientation` | `portrait`, `landscape` | `portrait` |

### Margins

Margins can be specified as a nested object or a CSS-style shorthand string.

=== "Shorthand (Recommended)"
    ```ldoc
    @document
      margins: "1in 1in 1in 1.25in" // top right bottom left
    ```

=== "Object Form"
    ```ldoc
    @document
      margins:
        top: 1in
        right: 1in
        bottom: 1in
        left: 1.25in
    ```

!!! tip
    Supported units: `in` (inches), `pt` (points), `cm`, `mm`.

### Spacing

Controls paragraph spacing and line height.

```ldoc
@document
  spacing:
    line: 1.5      // 1.5x line spacing
    before: 6pt    // Space before paragraph
    after: 12pt    // Space after paragraph
```

---

## Styles

Customize fonts and formatting project-wide.

| Target | Description |
|--------|-------------|
| `body` | Default paragraph text |
| `heading1` - `heading6` | Specific heading levels |
| `header` / `footer` | Page header/footer text |

!!! example "Advanced Styling"
    ```ldoc
    @document
      styles:
        heading1:
          font: Helvetica
          size: 24pt
          bold: true
          color: "#2E004B" // Deep Purple
    ```

---

## Complete Example

```ldoc
@document
  title: "Real Estate Purchase Agreement"
  author: "Smith & Associates"
  page_size: letter
  spacing: 1.5
  styles:
    body: { font: "Georgia", size: 11pt }
    heading1: { font: "Helvetica", bold: true, size: 18pt }

# Purchase Agreement

This Agreement is entered into...
```

!!! tip "Inheritance"
    Styles defined for `heading` (base) will be inherited by `heading1` through `heading6` unless overridden.
