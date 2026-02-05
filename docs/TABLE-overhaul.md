# Table Overhaul (LDOC v2)

## Status
PROPOSAL. This document describes a consistent, DRY, YAGNI-friendly syntax for table layout + styling in LDOC v2.

It is aligned with `docs/DESIGN-v2-syntax.md`:
- Function-call directives: `@name(args)`
- Named args use `key: value`
- Values are typed: numbers, lengths (incl `twip`), strings, lists
- Block vs inline content stays consistent (`@cell: ...` or indented blocks)

Non-goals:
- No attempt to mirror the full Word style system.
- No “one-off” knobs that don’t round-trip cleanly.

---

## Design Principles

1) Layered defaults (DRY): `@table` → `@row` → `@cell`
2) Minimal core (YAGNI): start with widths + spans + alignment
3) Stable mapping to DOCX: arguments should map to WordprocessingML with low ambiguity
4) Explicit precedence: cell overrides row overrides table

---

## Proposed Signatures

### `@table(...)`

```ldoc
@table(
  widths: [2in, 3in, 2in],
  width: 7in,
  layout: fixed,
  header,
  autofit,
  align: left,
  valign: top,
  padding: 0.08in,
  borders: grid,
  background: "#F5F5F5"
)
  ...
@end
```

Arguments:
- `widths: list[length|"auto"|"NN%"]` (optional) column widths
- `width: length|"NN%"` (optional) total table width
- `layout: "auto"|"fixed"` (optional) controls width behavior
- `header` (flag, optional) first row is header (syntactic convenience)
- `autofit` (flag, optional) allow Word to auto-fit columns
- `align: "left"|"center"|"right"` (optional) default cell horizontal alignment
- `valign: "top"|"middle"|"bottom"` (optional) default cell vertical alignment
- `padding: length | [v, h] | [t, r, b, l]` (optional) default cell padding
- `borders: "none"|"all"|"grid"|BorderObject` (optional)
- `background: Color` (optional) default cell background

### `@row(...)`

```ldoc
@row(
  header,
  height: 720twip,
  heightRule: exact,
  align: center,
  background: "#E0E0E0"
)
  ...
@end
```

Arguments:
- `header` (flag, optional) row is header
- `height: length` (optional) row height value
- `heightRule: "auto"|"atLeast"|"exact"` (optional)
- `align`, `valign`, `padding`, `background` (optional overrides for all cells in this row)

### `@cell(...)`

```ldoc
@cell(colspan: 2, rowspan: 3, align: right, valign: middle, padding: [2pt, 6pt], background: "#FFF9C4")
  Cell content...
@end

@cell: Simple content
```

Arguments:
- `colspan: number` (optional, default 1)
- `rowspan: number` (optional, default 1)
- `align`, `valign`, `padding`, `background` (optional)
- `borders` (optional) per-cell border override
- `width: length|"NN%"|"auto"` (optional) per-cell width override (advanced)
- `noWrap` (flag, optional)

---

## Types

### Length

`length` supports `in`, `pt`, `cm`, `mm`, `twip`.

Examples:
- `0.5in`
- `12pt`
- `720twip`

### Color

`Color` is either:
- highlight color names (DOCX highlight palette), e.g. `yellow`, `darkYellow`, `lightGray`
- hex: `#RRGGBB` or `RRGGBB`

### Padding

`padding` accepts:
- `padding: 0.08in` (all sides)
- `padding: [0.05in, 0.1in]` (vertical, horizontal)
- `padding: [t, r, b, l]`

### Borders

YAGNI core: allow string presets.

```ldoc
@table(borders: none)
@table(borders: all)
@table(borders: grid)
```

Optional extension: structured object.

```ldoc
@table(borders: {
  top: { style: thick, width: 2pt, color: "#000000" },
  bottom: { style: thick, width: 2pt },
  left: thick,
  right: thick,
  insideH: none,
  insideV: none
})
```

---

## Precedence (Cascade)

For each property:
1) `@cell(...)` value wins if present
2) else `@row(...)`
3) else `@table(...)`
4) else DOCX defaults

Merge rules:
- Scalars (e.g. `align`) inherit normally.
- `padding` and `borders` are not partially merged by default; specifying them replaces the inherited value.

---

## Examples

### 1) Readable defaults + overrides

```ldoc
@table(width: 6.5in, layout: fixed, widths: [1.5in, 3in, 2in], padding: 0.08in, borders: grid)
  @row(header, background: "#1A365D", align: center)
    @cell: **SKU**
    @cell: **Product Name**
    @cell: **Price**
  @row
    @cell: ABC-001
    @cell: Widget Pro
    @cell(align: right): $29.99
@end
```

### 2) Row height

```ldoc
@table(widths: [3in, 3in])
  @row(height: 0.5in, heightRule: exact)
    @cell: Fixed
    @cell: Fixed
  @row(height: 1in, heightRule: atLeast)
    @cell: Min
    @cell: Can grow
@end
```

### 3) Background shading

```ldoc
@table(widths: [2in, 4in], background: "#F5F5F5")
  @row(background: "#E0E0E0")
    @cell: Header 1
    @cell: Header 2
  @row
    @cell: Data
    @cell(background: "#FFF9C4"): Highlighted
@end
```

---

## DOCX Mapping (Implementation Notes)

This is a mapping target (not a requirement of the syntax itself):

- `@table(width: ...)` → `w:tblW`
- `@table(layout: fixed)` → `w:tblLayout w:type="fixed"`
- `@table(widths: [...])` → `w:tblGrid` + cell width application
- `@row(height, heightRule)` → `w:trPr/w:trHeight` (`w:val`, `w:hRule`)
- `padding` → `w:tcPr/w:tcMar`
- `background` → `w:tcPr/w:shd` (prefer shading fill)
- `borders` → `w:tblBorders` and/or `w:tcBorders`

---

## Rollout (YAGNI Phases)

Phase 0 (already):
- `@table(widths: [...])`
- `@cell(colspan/rowspan/align/valign)`

Phase 1 (high value, low complexity):
- `@row(height:, heightRule:)`
- `padding:` at table/cell
- `background:` at cell

Phase 2:
- `width:` + `layout:`
- `header` row support (repeat header)

Phase 3 (optional):
- `borders:` presets, then structured borders

---

## Migration

Existing v2 table syntax remains valid. New args are additive.

- Existing:
  - `@table(widths: [...])`
  - `@cell(colspan: 2, rowspan: 3, align: center, valign: top)`

- New (optional):
  - `@row(height: 720twip, heightRule: exact)`
  - `@table(padding: 0.08in, background: "#F5F5F5")`
