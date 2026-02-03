# Legal Document DSL Spec (Draft)

A lightweight markup language for legal documents that compiles to DOCX.

## Goals

- Write/edit legal documents in neovim
- Explicit structure (no detection/guessing)
- Compiles to properly formatted DOCX
- Round-trip: DOCX → DSL → DOCX (stretch goal)

---

## Document Structure

### @document

Document-wide metadata and settings. This block does not auto-render.

```
@document
  title: Real Estate Purchase Agreement
  page_size: letter
  orientation: portrait
  numbering: default
```

If you want a visible title in the DOCX, use a markdown header:

```
# REAL ESTATE PURCHASE AGREEMENT
```

---

### Headers

Standard markdown headers:

```
# Heading 1
## Heading 2
### Heading 3
```

**Example:**
```
# Real Estate Purchase Agreement

THIS AGREEMENT is made between {{seller}} and {{buyer}}.

## Recitals

Seller owns property at 301 Stillwater Road.

## Agreement

@1 Agreement of Sale.
...
```

---

### @meta

Document metadata and variable definitions.

```
@meta
  date: February [day], 2026
  effective: the date fully executed by both parties
  parties:
    seller: WALK THE LINE, LLC
    buyer: JAMES KELLY, or his assigns
  property:
    address: 301 Stillwater Road, Willernie, MN
    pin: 29.030.21.31.0084
    county: Washington
```

**Usage in document:**
```
This Agreement is between {{seller}} ("Seller") and {{buyer}} ("Buyer").
The property located at {{property.address}}...
```

**Renders as:**
```
This Agreement is between WALK THE LINE, LLC ("Seller") and 
JAMES KELLY, or his assigns ("Buyer"). The property located 
at 301 Stillwater Road, Willernie, MN...
```

---

## Modifiers

Modifiers wrap content to apply formatting. Two syntaxes:

### Single Line

```
@center # Real Estate Purchase Agreement

@center THIS AGREEMENT is made between the parties.

@right Page {{page}} of {{pages}}
```

### Multiline (Indented Block)

```
@center
  # Real Estate Purchase Agreement

@box
  **NOTICE:** This is important.
  Read carefully.

@indent
  "The Property shall mean all land, improvements,
  and fixtures located thereon."

@indent=36pt
  This paragraph is indented by an explicit length.
```

### Chaining / Nesting

**Chained (single line):**
```
@center @bold EXHIBIT A

@right @small Page {{page}}
```

**Nested (multiline):**
```
@center
  @box
    **NOTICE:** Important information.
    Please read carefully.
```

Modifiers wrap inward - innermost applies first to content.

---

### Available Modifiers

| Modifier | Effect |
|----------|--------|
| `@center` | Center-aligned |
| `@right` | Right-aligned |
| `@indent` | Indented block |
| `@box` | Bordered box |
| `@bold` | Bold text |
| `@italic` | Italic text |
| `@small` | Smaller font |
| `@caps` | All caps |

`@indent` / `@outdent` can optionally take a numeric argument:

- **Count form:** `@indent:2` or `@indent 2` (2 steps, where each step is 0.5in)
- **Length form:** `@indent=36pt` / `@indent=1.25in` / `@indent=2cm` / `@indent=10mm`

---

## Numbered Lists

### Core Concept: Depth via @ Count

The number of `@` symbols indicates nesting depth:

| Syntax | Level | Example |
|--------|-------|---------|
| `@`    | 1     | `@1 Agreement` |
| `@@`   | 2     | `@@a the building` |
| `@@@`  | 3     | `@@@i warranty deed` |
| `@@@@` | 4     | `@@@@A sub-detail` |

The number/letter after `@` is **optional** and determines the **style**:

| Marker | Style | Renders as |
|--------|-------|------------|
| `@1`   | decimal | 1. |
| `@@a`  | alpha | (a) |
| `@@2.1`| decimal | 2.1. |
| `@@@i` | roman | (i) |
| `@@`   | auto | continues previous style |

**Important:** A list marker must be followed by whitespace (space or tab) or a newline. This prevents email-style mentions like `@someone` from being parsed as list items.

```
@1 This is a list item (space after @1)
@someone This is NOT a list item (no space after valid style)
Contact @john for help (treated as plain text)
```

---

### Basic Example

```
@1 Agreement of Sale.
Seller hereby agrees to sell to Buyer...

@2 Purchase Price.
The purchase price is ONE MILLION DOLLARS ($1,000,000).

@3 Due Diligence.
Buyer shall have 15 days to inspect the Property.
```

**Renders as:**
```
1.  Agreement of Sale. Seller hereby agrees to sell to Buyer...

2.  Purchase Price. The purchase price is ONE MILLION DOLLARS 
    ($1,000,000).

3.  Due Diligence. Buyer shall have 15 days to inspect the 
    Property.
```

---

### Mixed Styles Per Section

You choose the style at each level. It persists until you change it.

```
@1 Agreement of Sale.
Seller agrees to sell the following:

@@a the building and improvements (the "Improvements");
@@b all contracts and permits (the "Assumed Contracts");
@@c furniture per Exhibit B (the "Personal Property").

@2 Purchase Price.
One million dollars, payable as follows:

@@2.1 Earnest money of $10,000.
@@2.2 Balance at Closing via wire transfer.

@3 Representations.

@@a Seller represents:
@@@i no litigation pending;
@@@ii no liens exist;
@@@iii authority to sell.

@@b Buyer represents:
@@@3.2.1 has authority to execute;
@@@3.2.2 has funds available.
```

**Renders as:**
```
1.  Agreement of Sale. Seller agrees to sell the following:

    (a) the building and improvements (the "Improvements");
    (b) all contracts and permits (the "Assumed Contracts");
    (c) furniture per Exhibit B (the "Personal Property").

2.  Purchase Price. One million dollars, payable as follows:

    2.1.  Earnest money of $10,000.
    2.2.  Balance at Closing via wire transfer.

3.  Representations.

    (a) Seller represents:
        (i)   no litigation pending;
        (ii)  no liens exist;
        (iii) authority to sell.

    (b) Buyer represents:
        3.2.1.  has authority to execute;
        3.2.2.  has funds available.
```

---

### Auto-Increment

Omit the number/letter to auto-increment in the current style:

```
@1 First section.
@@ First sub (starts at 1.1 or (a) based on context)
@@ Second sub (auto: 1.2 or (b))
@@ Third sub (auto: 1.3 or (c))

@2 Second section.
@@a Explicit alpha style.
@@ Auto-continues: (b)
@@ Auto-continues: (c)
```

---

### Deep Nesting

```
@1 Closing.

@@a Seller's Documents:
@@@i warranty deed;
@@@ii bill of sale;
@@@iii settlement statement.

@@b Buyer's Obligations:
@@@i wire transfer the balance;
@@@ii execute settlement statement;
@@@iii provide proof of insurance.

@@c Title Company Actions:
@@@i record the deed;
@@@ii disburse funds;
@@@@A to Seller per settlement;
@@@@B to payoff existing liens.
```

**Renders as:**
```
1.  Closing.

    (a) Seller's Documents:
        (i)   warranty deed;
        (ii)  bill of sale;
        (iii) settlement statement.

    (b) Buyer's Obligations:
        (i)   wire transfer the balance;
        (ii)  execute settlement statement;
        (iii) provide proof of insurance.

    (c) Title Company Actions:
        (i)   record the deed;
        (ii)  disburse funds;
              (A) to Seller per settlement;
              (B) to payoff existing liens.
```

---

### Style Reference

| Marker | Style | Output Format |
|--------|-------|---------------|
| `@1`, `@2` | Decimal | 1. 2. 3. |
| `@@1.1` | Decimal sub | 1.1. 1.2. 1.3. |
| `@@a`, `@@b` | Alpha lower | (a) (b) (c) |
| `@@A`, `@@B` | Alpha upper | (A) (B) (C) |
| `@@@i`, `@@@ii` | Roman lower | (i) (ii) (iii) |
| `@@@I`, `@@@II` | Roman upper | (I) (II) (III) |

---

### Default Scheme

If you never specify a style, defaults cascade:

```
@numbering default
```
- Level 1: `1.` `2.` `3.` (flush-left, number starts at margin)
- Level 2: `(a)` `(b)` `(c)`
- Level 3: `(i)` `(ii)` `(iii)`
- Level 4: `(A)` `(B)` `(C)`

```
@numbering decimal
```
- All levels: `1.` -> `1.1.` -> `1.1.1.` -> `1.1.1.1.`

The `@numbering` directive must appear before any numbered items. Level-1 items are flush-left (number at the left margin, text indented 0.25 inches).

---

### Continuation Paragraphs

Unnumbered text under a numbered section.

```
@1 Purchase Price.
The purchase price is ONE MILLION DOLLARS ($1,000,000).

  This amount shall be paid as follows:

  @a Earnest money of $10,000.
  @b Balance at Closing.

  All funds shall be delivered via wire transfer.
```

**Renders as:**
```
1.  Purchase Price. The purchase price is ONE MILLION DOLLARS 
    ($1,000,000).

    This amount shall be paid as follows:

    1.1.  Earnest money of $10,000.
    1.2.  Balance at Closing.

    All funds shall be delivered via wire transfer.
```

- Continuation text indented to match parent level
- Not numbered

---

## Extensibility

### @import

Import block definitions from a template file:

```
@import legal-blocks
@import brodielaw/defaults
@import ./my-templates
```

Searches for:
- `legal-blocks.ldoc` in standard template paths
- `brodielaw/defaults.ldoc` for namespaced templates
- `./my-templates.ldoc` for relative paths

---

### @define

Define reusable blocks in a template file:

**legal-blocks.ldoc:**
```
@define signature(party)
  @params
    entity: optional
    name: optional
    by: optional
    title: optional
  @template
    {{party | upper}}:
    
    @if entity
      {{entity}}
      
      
      By: ________________________________
          {{by}}
          Its: {{title}}
    @else
      ________________________________
      {{name}}
    @end
    
    
    Date: ______________________________

@define witness()
  @params
    count: 2
    names: []
  @template
    WITNESSES:
    
    @repeat count
      ________________________________
      Witness Signature
      
      @if names[i]
        {{names[i]}}
      @else
        ________________________________
        Print Name
      @end
    @end

@define notary(state, county)
  @template
    STATE OF {{state | upper}}    )
                                  ) ss.
    COUNTY OF {{county | upper}}  )
    
    The foregoing instrument was acknowledged before me this _____ day
    of _____________, 20___, by ________________________________.
    
    
                                  ________________________________
                                  Notary Public
    
    My Commission Expires: _________________
```

---

### Definition Syntax

| Element | Purpose |
|---------|---------|
| `@define name(required_params)` | Block name and required params |
| `@params` | Optional params with defaults |
| `@template` | The content to render |
| `{{var}}` | Variable substitution |
| `{{var \| filter}}` | Filters: `upper`, `lower`, `capitalize` |
| `@if` / `@else` / `@end` | Conditionals |
| `@repeat count` | Loops |

---

### Usage

```
@import legal-blocks

@signature Seller
  entity: WALK THE LINE, LLC
  by: Gordon Johnson
  title: Chief Manager

@signature Buyer
  name: James Kelly

@witness
  count: 2
  names:
    - John Smith
    - Jane Doe

@notary
  state: Minnesota
  county: Washington
```

---

## Signature Blocks

Signature blocks are defined via the extensibility system. Import the standard library:

```
@import legal-blocks
```

Then use the blocks:

```
@signature Seller
  entity: WALK THE LINE, LLC
  by: Gordon Johnson
  title: Chief Manager

@signature Buyer
  name: James Kelly

@witness
  count: 2

@notary Minnesota, Washington
```

See the **Extensibility** section above for full definitions and customization.

---

## Exhibits

Just use `@pagebreak` and centered headers:

```
@pagebreak

@center
  # EXHIBIT A
  
  Legal Description of the Property

Lots 5 and 6, Block 6, Wildwood Manor, Washington County, Minnesota

Tax Parcel Identification No(s). 29.030.21.31.0084
```

**Renders as:**
```
                              EXHIBIT A

                    Legal Description of the Property


Lots 5 and 6, Block 6, Wildwood Manor, Washington County, Minnesota

Tax Parcel Identification No(s). 29.030.21.31.0084
```

---

### Exhibit with List

```
@pagebreak

@center
  # EXHIBIT B
  
  Personal Property Included in Sale

@- Kitchen equipment
@@- Southbend Broiler
@@- Superior Stove
@@- Vulcan convection oven
@- Front house furniture
@@- Tables and chairs
@@- 10 leather booths
@@- Bar stools
@- Office equipment
@@- Desk
@@- Filing cabinets
@@- Safe
```

**Renders as:**
```
                              EXHIBIT B

                    Personal Property Included in Sale


• Kitchen equipment
    ○ Southbend Broiler
    ○ Superior Stove
    ○ Vulcan convection oven
• Front house furniture
    ○ Tables and chairs
    ○ 10 leather booths
    ○ Bar stools
• Office equipment
    ○ Desk
    ○ Filing cabinets
    ○ Safe
```

---

## Tables

### Basic Table

```
@table
  [Item, Seller Pays, Buyer Pays]
  [Title Commitment, X, ""]
  [Deed Tax, X, ""]
  [Recording Fee, "", X]
  [Title Insurance, "", X]
  [Escrow Fee, 1/2, 1/2]
```

**Renders as:**

| Item | Seller Pays | Buyer Pays |
|------|-------------|------------|
| Title Commitment | X | |
| Deed Tax | X | |
| Recording Fee | | X |
| Title Insurance | | X |
| Escrow Fee | 1/2 | 1/2 |

**Rules:**
- Each `[...]` is a row
- First row is the header
- Cells separated by `,`
- Use quotes for content with `,` or `:`: `"Escrow Fee, Split"`
- Empty cell: `""`

**Default Styling:**
- Legal grid: thin black borders (0.5pt) on all sides and between cells
- Header row: light gray background (#F2F2F2), bold text
- Cell padding: ~120 twips (~0.08 inches) on all sides
- Column widths: auto-fit to content
- Vertical alignment: top

---

### Table with Modifiers

```
@center
  @table
    [Item, Seller Pays, Buyer Pays]
    [Title Commitment, X, ""]
    [Escrow Fee, 1/2, 1/2]
```

---

### Table with Special Characters

```
@table
  [Description, Amount, Notes]
  ["Earnest Money, Non-Refundable", "$10,000", "Due at signing"]
  [Balance, "$990,000", "Wire transfer only"]
  ["See Section 5.2: Prorations", "", "Calculated at closing"]
```

---

## Inline Elements

### Defined Terms

```
The "Property" includes the land and all improvements.
Later reference to the Property shall mean...
```

**Behavior:**
- First occurrence: bold, quoted
- Subsequent: regular text
- Auto-tracked for optional Definitions section

---

### Cross-References

```
As described in [[Section 5.2]], the Buyer shall...
Subject to [[Exhibit A]], the Property includes...
```

**Renders as:**
- Hyperlinked in DOCX
- Validated at compile time (warning if target doesn't exist)

---

### Blanks

```
Closing shall occur on _________________________.
Purchase price is _____________ DOLLARS.
Signed this _____ day of _____________, 2026.
```

**Renders as-is.** The number of underscores you type = the line length you get.

Minimum 3 underscores to trigger a blank line.

---

### Emphasis

```
**bold text**
*italic text*
***bold italic***
ALL CAPS automatically preserved
```

**Examples:**
```
The **"Property"** includes *all* improvements described herein.
Seller makes ***no warranty*** regarding condition.
```

**Renders as:**

The **"Property"** includes *all* improvements described herein.
Seller makes ***no warranty*** regarding condition.

---

## Comments

```
// This is a line comment (not rendered)

/* 
   This is a block comment
   spanning multiple lines
*/

@todo Review this section with attorney
```

**@todo items:**
- Not rendered in final DOCX
- Could generate a separate review checklist

---

## Page Control

### Common

```
@pagebreak

@header
  left: Real Estate Purchase Agreement
  right: Page {{page}} of {{pages}}

@footer
  center: Confidential
```

### First Page Different

```
@firstpage
  @header
    center:
  @footer
    center: Draft - Not for Execution
```

### Optional Settings

```
@document
  page_size: letter
  orientation: portrait
  margins:
    top: 1in
    right: 1in
    bottom: 1in
    left: 1in
  spacing:
    line: 1.5
  numbering: default
```

### Typography

Customize fonts, sizes, and colors via `@document.styles`:

```
@document
  styles:
    body:
      font: Georgia
      size: 11pt
    heading1:
      font: Helvetica
      size: 24pt
      color: "#333333"
    header:
      font: Arial
      size: 9pt
    footer:
      font: Arial
      size: 9pt
      color: "#666666"
```

**Supported Targets:**

| Target | Applies to |
|--------|------------|
| `body` | Normal paragraph text |
| `heading1` | `# Heading 1` markdown headers |
| `heading2` | `## Heading 2` markdown headers |
| `heading3` | `### Heading 3` markdown headers |
| `header` | Document header content |
| `footer` | Document footer content |

**Supported Keys:**

| Key | Format | Example |
|-----|--------|---------|
| `font` | Quoted font name | `font="Times New Roman"` |
| `size` | Points (pt only) | `size=12pt` |
| `color` | Hex color | `color=#333333` |

**Notes:**
- Document-wide options must be configured in `@document`.
- Size must use `pt` units (pixels, em, etc. are not supported).
- Colors must be hex format (`#RRGGBB`), not named colors.

**Example:**

```
@document
  styles:
    body:
      font: Georgia
      size: 11pt
    heading1:
      font: Helvetica
      size: 24pt

# Contract Agreement

This document uses Georgia for body text and Helvetica for headings.
```

### Multi-Column Regions

Use `@columns` to create a multi-column section. The region ends with `@;`:

```
@columns 2 gap=0.5in separator
  First column content...
  
  More content...
@;

Back to single column here.
```

**Options:**
- First argument: number of columns (1-10)
- `gap=<length>`: space between columns (default: 0.5in)
- `separator`: draw a line between columns

Most documents won't need these - they'll inherit from the template.

---

## Full Example

```
@document
  title: Real Estate Purchase Agreement
  page_size: letter
  orientation: portrait
  numbering: default

@import legal-blocks

@meta
  date: February [day], 2026
  parties:
    seller: WALK THE LINE, LLC
    buyer: JAMES KELLY

@center
  # Real Estate Purchase Agreement

THIS PURCHASE AGREEMENT ("Agreement") is made between 
{{seller}} ("Seller") and {{buyer}} ("Buyer").

## Recitals

Seller owns property at 301 Stillwater Road.
Buyer wishes to purchase the Property.

## Agreement

@1 Agreement of Sale.
Seller agrees to sell to Buyer the Property, including:

@@a the building and improvements (the "Improvements");
@@b all contracts and permits (the "Assumed Contracts");
@@c personal property per [[Exhibit B]].

@2 Purchase Price.
The price is ONE MILLION DOLLARS ($1,000,000):

@@2.1 $10,000 earnest money at signing.
@@2.2 Balance at Closing via wire transfer.

@3 Closing.
Closing on or before March 1, 2026.

@@a Seller delivers:
@@@i Warranty deed;
@@@ii Bill of sale;
@@@iii Settlement statement.

@@b Buyer delivers:
@@@i Purchase price;
@@@ii Signed settlement statement.

@signature Seller
  entity: WALK THE LINE, LLC
  by: Gordon Johnson
  title: Chief Manager

@signature Buyer
  name: James Kelly

@notary Minnesota, Washington

@pagebreak

@center
  # EXHIBIT A
  
  Legal Description

Lots 5 and 6, Block 6, Wildwood Manor, Washington County, MN

@pagebreak

@center
  # EXHIBIT B
  
  Personal Property

@- Kitchen equipment
@@- Southbend Broiler
@@- Superior Stove
@- Furniture
@- Office equipment
```

---

## File Extension

**Decided:** `.ldoc` (legal document)

---

## Design Decisions

| Question | Decision |
|----------|----------|
| Indentation vs explicit nesting | Indentation - cleaner, fits legal doc structure |
| Template system | `@import` + `@define` with params, conditionals, loops |
| Conditional content | `@if`/`@else`/`@end` within templates |
| Signature blocks | Extensible via `legal-blocks` template library |
| Blanks/fill-ins | WYSIWYG underscores (`_____`) |
| Cross-references | `[[Section 5.2]]` syntax, validated at compile |

---

## Open Questions

1. **Standard template library location?**
   - System-wide: `~/.config/ldoc/templates/`?
   - Project-local: `./.ldoc/`?
   - Both with cascade?

2. **Diff-friendly format?**
   - One sentence per line for better git diffs?
   - Or preserve natural paragraph flow?

3. **Error handling?**
   - Strict (fail on undefined variable)?
   - Lenient (render placeholder)?

---

## Implementation Phases

### Phase 1: MVP Parser
- [ ] Lexer for `@`, `@@`, `@@@` numbered lists
- [ ] Parse modifiers (`@center`, `@bold`, etc.)
- [ ] Variable substitution (`{{var}}`)
- [ ] Compile to DOCX via python-docx
- [ ] Neovim syntax highlighting (`.vim` or TreeSitter)

### Phase 2: Full Features
- [ ] `@meta` block parsing
- [ ] `@table` support
- [ ] `@import` and `@define` extensibility
- [ ] Cross-reference validation
- [ ] Page control (`@pagebreak`, `@header`, `@footer`)

### Phase 3: Tooling
- [ ] CLI: `ldoc compile doc.ldoc -o doc.docx`
- [ ] CLI: `ldoc watch doc.ldoc` (auto-recompile)
- [ ] Neovim preview (PDF popup via `:LdocPreview`)
- [ ] LSP for autocomplete, go-to-definition, diagnostics

### Phase 4: Round-Trip (Stretch)
- [ ] DOCX → `.ldoc` reverse conversion
- [ ] Clause library management
- [ ] Diff/merge tooling for legal review
