# LDOC v2 Syntax Design

## Status: PROPOSAL (Breaking Changes Authorized)

## Executive Summary

This document proposes a **v2 syntax** for LDOC directives that prioritizes **elegance, consistency, and readability**. Unlike the previous "unified" proposal which preserved backward compatibility, this design is free to make breaking changes.

### Design Philosophy

1. **One Way to Do Things**: Eliminate syntax variations
2. **Function-Call Semantics**: All directives use `@name(args)` syntax
3. **Typed Arguments**: First-class support for lists, numbers, and lengths
4. **Visual Clarity**: Clear distinction between control flow and formatting
5. **Minimal Surprises**: Same syntax patterns across all directives

---

## Syntax Overview

### Core Syntax: Function-Call Style

**All directives** follow the same pattern:

```
@directive(arg1, arg2, key: value, flag)
```

This is inspired by Typst's function syntax but adapted for readability in a document context.

### Grammar (EBNF)

```ebnf
directive      := "@" name args? block?
args           := "(" arg_list? ")"
arg_list       := arg ("," arg)*
arg            := flag | named_arg | positional_arg

flag           := identifier                           (* bold, italic, header *)
named_arg      := identifier ":" value                 (* gap: 0.5in *)
positional_arg := value                                (* 3, "hello" *)

value          := literal | list | expression
literal        := number | length | string | boolean
number         := digit+ ("." digit+)?
length         := number unit                          (* 2in, 12pt, 1.5cm *)
unit           := "in" | "pt" | "cm" | "mm" | "twip"
string         := '"' [^"]* '"'                        (* quoted string *)
boolean        := "true" | "false"
list           := "[" value ("," value)* "]"           (* [1in, 2in, 3in] *)
expression     := identifier | identifier "." identifier | comparison

block          := NEWLINE INDENT content* DEDENT       (* indented block *)
                | ":" inline_content                   (* inline content *)

identifier     := letter (letter | digit | "_" | "-")*
```

### Key Design Decisions

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Separator** | `,` (comma) | Familiar from programming, clear boundaries |
| **Named syntax** | `key: value` | Cleaner than `key=value`, Typst/YAML style |
| **Lists** | `[a, b, c]` | First-class support, no string parsing |
| **Parentheses** | Required for args | Clear distinction between `@table` (no args) and `@table(...)` |
| **Inline content** | `:` syntax | Short form for single-line content |

---

## Directive Categories

### 1. Control Flow Directives

These control document logic and iteration.

#### `@if` / `@elseif` / `@else`

```ldoc
@if(condition)
  Content when true.
@elseif(other_condition)
  Alternative content.
@else
  Default content.
@end
```

**Arguments:**
- **positional[0]**: `expression` (required) - The condition to evaluate

**Examples:**
```ldoc
// Simple condition
@if(show_section)
  Visible content.
@end

// Comparison
@if(price > 100000)
  **HIGH VALUE TRANSACTION**
@end

// Property access
@if(parties.seller.is_corporate)
  Corporate seller provisions.
@end
```

#### `@foreach`

```ldoc
@foreach(item, in: collection)
  Content with {{item}}.
@end
```

**Arguments:**
- **positional[0]**: `identifier` (required) - Loop variable name
- **in**: `expression` (required) - Collection to iterate

**Examples:**
```ldoc
@foreach(party, in: parties)
  Party: {{party.name}}
@end

// With index (future enhancement)
@foreach(item, in: items, index: i)
  {{i + 1}}. {{item}}
@end
```

#### `@repeat`

```ldoc
@repeat(count)
  Repeated content.
@end
```

**Arguments:**
- **positional[0]**: `number` (required) - Number of repetitions (0-100)

**Examples:**
```ldoc
@repeat(5)
  _______________________ (Signature Line)
@end
```

#### `@set`

```ldoc
@set(variable, value: expression)
```

**Arguments:**
- **positional[0]**: `identifier` (required) - Variable name
- **value**: `expression` (required) - Value expression

**Examples:**
```ldoc
@set(count, value: count + 1)
@set(total, value: price * quantity)
@set(name, value: "John Doe")
```

---

### 2. Layout Directives

These control page and content layout.

#### `@columns`

```ldoc
@columns(count, gap: length, separator)
  Column content...
  @break
  Next column...
@end
```

**Arguments:**
- **positional[0]**: `number` (required) - Number of columns (1-10)
- **gap**: `length` (optional, default: `0.5in`) - Space between columns
- **separator**: `flag` (optional) - Show vertical line between columns

**Examples:**
```ldoc
// Two columns, default gap
@columns(2)
  Left column content.
  @break
  Right column content.
@end

// Three columns with custom gap and separator
@columns(3, gap: 0.25in, separator)
  First column.
  @break
  Second column.
  @break
  Third column.
@end
```

#### `@pagebreak`

```ldoc
@pagebreak
```

No arguments. Inserts a page break.

#### `@header` / `@footer`

```ldoc
@header: Page {{page}} of {{pages}}

@footer
  Confidential - {{title}}
@end
```

**Arguments:**
- None for default header/footer
- Use `@firstpage @header` for first page variant
- Use `@evenpage @footer` for even page variant

---

### 3. Table Directives

Tables have been completely redesigned for elegance.

#### `@table`

```ldoc
@table(widths: [2in, 3in, 2in], header)
  @row
    @cell: Header 1
    @cell: Header 2
    @cell: Header 3
  @row
    @cell: Data 1
    @cell: Data 2
    @cell: Data 3
@end
```

**Arguments:**
- **widths**: `list[length]` (optional) - Column widths as a list
- **width**: `length` (optional) - Total table width
- **header**: `flag` (optional) - First row is header
- **autofit**: `flag` (optional) - Auto-fit column widths

**Also supports legacy bracket syntax** (within table block):
```ldoc
@table(widths: [2in, 3in])
  [Header 1, Header 2]
  [Cell A, Cell B]
@end
```

#### `@row`

```ldoc
@row(header)
  @cell: Content
@end
```

**Arguments:**
- **header**: `flag` (optional) - This row is a header row

#### `@cell`

```ldoc
@cell(colspan: 2, rowspan: 3, align: center, valign: top)
  Cell content that can span
  multiple paragraphs.
@end

// Or inline:
@cell: Simple content
```

**Arguments:**
- **colspan**: `number` (optional, default: 1) - Columns to span
- **rowspan**: `number` (optional, default: 2) - Rows to span
- **width**: `length` (optional) - Cell width
- **align**: `left | center | right` (optional) - Horizontal alignment
- **valign**: `top | middle | bottom` (optional) - Vertical alignment

---

### 4. Formatting Directives

#### `@style`

The universal formatting directive. Replaces separate `@bold`, `@italic`, etc.

```ldoc
// Block form
@style(bold, italic, color: red, font: "Times New Roman")
  Formatted paragraph.

// Inline form
Text with @style(bold)[important] words.
```

**Arguments (all optional flags/named):**
- **bold**: `flag` - Bold text
- **italic**: `flag` - Italic text
- **underline**: `flag` - Underlined text
- **strike**: `flag` - Strikethrough text
- **caps**: `flag` - All caps
- **small-caps**: `flag` - Small caps
- **subscript**: `flag` - Subscript
- **superscript**: `flag` - Superscript
- **font**: `string` - Font family name
- **size**: `length` - Font size (e.g., `12pt`)
- **color**: `string` - Text color (name or hex)
- **background**: `string` - Highlight/background color
- **spacing**: `length` - Letter spacing (run character spacing)

**Inline Syntax:**
```ldoc
This has @style(bold)[strong emphasis] in it.
This has @style(color: red, italic)[warning text] here.
```

**Notes:**
- `background:` accepts either a standard highlight color name (e.g. `yellow`, `lightGray`, `darkYellow`) or a hex color (`#RRGGBB`).
- `spacing:` is interpreted as DOCX run character spacing in twips (1/20 pt). Examples: `1pt`, `2twip`, `0.5mm`.

#### Convenience Aliases

These are syntactic sugar that expand to `@style(...)`:

```ldoc
@bold: Text           // Expands to @style(bold): Text
@italic: Text         // Expands to @style(italic): Text
@center: Text         // Expands to @style(align: center): Text
@right: Text          // Expands to @style(align: right): Text
@highlight(yellow): Text  // Expands to @style(background: yellow): Text
```

#### `@indent`

```ldoc
@indent(2)            // Indent by 2 levels (default: 0.5in per level)
  Indented content.

@indent(length: 1in)  // Indent by specific amount
  Indented content.
```

**Arguments:**
- **positional[0]**: `number` (optional) - Indent levels
- **length**: `length` (optional) - Exact indent amount

---

### 5. Macro Directives

#### `@define`

```ldoc
@define(name, param1, param2, optional_param: "default")
  Template content using {{param1}} and {{param2}}.
  Optional: {{optional_param}}
@end
```

**Arguments:**
- **positional[0]**: `identifier` (required) - Macro name
- **positional[1..n]**: `identifier` (optional) - Required parameter names
- **named**: `identifier: value` (optional) - Optional parameters with defaults

**Examples:**
```ldoc
@define(signature_block, name, title: "")
  _______________________________
  {{name}}
  @if(title)
    {{title}}
  @end
@end

@define(notice, level, message)
  @style(bold, color: @if(level == "warning")[orange]@else[red])
    {{level | upper}}: {{message}}
@end
```

#### `@use`

```ldoc
@use(macro_name, arg1, arg2, named_arg: value)
```

**Arguments:**
- **positional[0]**: `identifier` (required) - Macro name to invoke
- **positional[1..n]**: `value` (optional) - Positional arguments
- **named**: `identifier: value` (optional) - Named arguments

**Examples:**
```ldoc
@use(signature_block, name: "John Doe", title: "CEO")

@use(notice, "warning", "This is a warning message")
```

#### `@slot`

Used inside `@define` to mark where child content goes:

```ldoc
@define(callout, type)
  @style(background: light-blue)
    @slot
@end

@use(callout, type: "info")
  This content goes into the slot.
@end
```

---

### 6. Structure Directives

#### `@anchor`

```ldoc
@anchor(name)
```

**Arguments:**
- **positional[0]**: `string` (required) - Anchor name for cross-references

#### `@import`

```ldoc
@import(path)
```

**Arguments:**
- **positional[0]**: `string` (required) - Path to import

---

## Complete Before/After Comparison

### `@table`

**v1 (Current):**
```ldoc
@table widths=2in,3in,2in
  [Header 1, Header 2, Header 3]
  [Cell 1, Cell 2, Cell 3]
```

**v2 (Proposed):**
```ldoc
@table(widths: [2in, 3in, 2in])
  [Header 1, Header 2, Header 3]
  [Cell 1, Cell 2, Cell 3]
@end
```

### `@columns`

**v1 (Current):**
```ldoc
@columns 2 gap=0.5in separator
  Content...
@end
```

**v2 (Proposed):**
```ldoc
@columns(2, gap: 0.5in, separator)
  Content...
@end
```

### `@repeat`

**v1 (Current):**
```ldoc
@repeat 3
  Content...
@end
```

**v2 (Proposed):**
```ldoc
@repeat(3)
  Content...
@end
```

### `@foreach`

**v1 (Current):**
```ldoc
@foreach item in items
  {{item}}
@end
```

**v2 (Proposed):**
```ldoc
@foreach(item, in: items)
  {{item}}
@end
```

### `@set`

**v1 (Current):**
```ldoc
@set count = count + 1
```

**v2 (Proposed):**
```ldoc
@set(count, value: count + 1)
```

### `@style`

**v1 (Current):**
```ldoc
@style font-size=12pt color=red
  Text

@style(color=blue bold)[inline text]
```

**v2 (Proposed):**
```ldoc
@style(size: 12pt, color: red)
  Text

@style(color: blue, bold)[inline text]
```

### `@define` / `@use`

**v1 (Current):**
```ldoc
@define MyMacro(param)
  Content {{param}}

@use MyMacro(param="value")
```

**v2 (Proposed):**
```ldoc
@define(MyMacro, param)
  Content {{param}}
@end

@use(MyMacro, param: "value")
```

### `@if`

**v1 (Current):**
```ldoc
@if condition > 5
  Content
@end
```

**v2 (Proposed):**
```ldoc
@if(condition > 5)
  Content
@end
```

### `@indent`

**v1 (Current):**
```ldoc
@indent:2
  Content

@indent=36pt
  Content
```

**v2 (Proposed):**
```ldoc
@indent(2)
  Content

@indent(length: 36pt)
  Content
```

---

## Rationale: Why This is More Elegant

### 1. **Consistency**

Every directive follows the exact same pattern:
- `@name` - Directive with no arguments
- `@name(args)` - Directive with arguments
- `@name: content` - Directive with inline content
- `@name(args): content` - Both

No more remembering:
- "Does `@table` use `widths=` or `widths:`?"
- "Is `@repeat` followed by a number or `count=`?"
- "Does `@foreach` use `in` keyword or `in:` parameter?"

### 2. **First-Class Types**

Lists are proper syntax, not comma-separated strings:
```ldoc
// v1: Parse error-prone string
widths="2in, 3in, 2in"

// v2: Proper list syntax
widths: [2in, 3in, 2in]
```

### 3. **Visual Distinction**

The parentheses clearly mark "this directive has configuration":
```ldoc
@pagebreak              // No config needed
@table(widths: [...])   // Configured table
```

### 4. **Familiar Semantics**

The syntax resembles function calls in many languages:
- TypeScript: `table({ widths: [...] })`
- Python: `table(widths=[...])`
- Typst: `#table(widths: (...))`

### 5. **Unambiguous Parsing**

The grammar is LL(1) parseable with no lookahead ambiguity:
- `@` starts directive
- `(` starts argument list
- `:` after `)` or after name starts inline content
- Newline + indent starts block content

### 6. **Extensibility**

Adding new arguments to any directive is trivial:
```ldoc
// Today
@table(widths: [...])

// Tomorrow (add borders)
@table(widths: [...], borders: all, border-color: gray)
```

---

## Implementation Impact

### Lexer Changes

**Simplification**: The lexer no longer parses directive arguments. It emits:

```typescript
interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  // REMOVED: attributes, count, length, rawParams
}
```

New token type for directive arguments:
```typescript
TokenType.DIRECTIVE_OPEN  // "@name("
TokenType.DIRECTIVE_CLOSE // ")"
TokenType.COLON           // ":"
TokenType.COMMA           // ","
TokenType.LBRACKET        // "["
TokenType.RBRACKET        // "]"
```

**Lexer scanAtCommand() becomes ~50 lines** (down from 300+):
1. Consume `@`
2. Read identifier
3. Check for `(`
4. Emit appropriate token

### Parser Changes

New **argument parser** module (~150 lines):

```typescript
interface DirectiveArgs {
  positional: Value[];
  named: Record<string, Value>;
  flags: Set<string>;
}

type Value = 
  | { type: 'number'; value: number }
  | { type: 'length'; value: number; unit: string }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'list'; items: Value[] }
  | { type: 'expression'; raw: string }
  | { type: 'identifier'; name: string };

function parseDirectiveArgs(stream: TokenStream): DirectiveArgs;
```

Each directive parser becomes simpler:
```typescript
function parseRepeat(ctx: ParserContext): RepeatNode {
  const token = ctx.stream.expect(TokenType.REPEAT);
  const args = parseDirectiveArgs(ctx.stream);
  
  // Type-safe argument extraction
  const count = args.positional[0];
  if (!count || count.type !== 'number') {
    throw new DirectiveError('@repeat', 'requires a count', token);
  }
  
  const body = parseBlock(ctx);
  return { type: 'repeat', count: count.value, body, ... };
}
```

### AST Changes

AST nodes gain typed argument fields:

```typescript
interface RepeatNode extends BaseNode {
  type: "repeat";
  count: number;  // Already typed!
  body: Node[];
}

interface ColumnsRegionNode extends BaseNode {
  type: "columns_region";
  columnCount: number;
  gapTwip: number;      // Parsed from length
  separator: boolean;   // Parsed from flag
  children: Node[];
}

interface TableNode extends BaseNode {
  type: "table";
  columnWidths?: number[];  // Parsed from list of lengths
  hasHeader?: boolean;      // Parsed from flag
  autofit?: boolean;        // Parsed from flag
  rows: TableRowNode[];
}
```

### Migration Tooling

A **codemod tool** can automatically convert v1 to v2:

```bash
ldoc migrate --from v1 --to v2 document.ldoc
```

Transformations:
- `@repeat 3` -> `@repeat(3)`
- `@foreach x in items` -> `@foreach(x, in: items)`
- `@table widths=1in,2in` -> `@table(widths: [1in, 2in])`
- `@columns 2 gap=0.5in separator` -> `@columns(2, gap: 0.5in, separator)`

---

## Appendix: Token Examples

```
Input: @table(widths: [2in, 3in], header)

Tokens:
  DIRECTIVE_NAME "table"
  LPAREN
  IDENTIFIER "widths"
  COLON
  LBRACKET
  LENGTH "2in"
  COMMA
  LENGTH "3in"
  RBRACKET
  COMMA
  IDENTIFIER "header"
  RPAREN
  NEWLINE
  ...
```

```
Input: @if(price > 100)

Tokens:
  DIRECTIVE_NAME "if"
  LPAREN
  EXPRESSION "price > 100"
  RPAREN
  NEWLINE
  ...
```

---

## Open Questions

1. **Expression Syntax**: Should we support richer expressions inside `()`?
   - Current: `@if(price > 100)` - condition is raw string
   - Alternative: Parse expressions into AST for type checking

2. **Optional Parentheses**: Should no-arg directives allow empty parens?
   - `@pagebreak` vs `@pagebreak()`
   - Recommendation: Both valid, `()` is optional when empty

3. **Inline Content with Args**: Is `:` after `)` the right syntax?
   - `@style(bold): Inline text`
   - Alternative: `@style(bold) Inline text` (space-separated)

4. **Block Termination**: Should we require `@end` for all blocks?
   - Current: Python-style indent is sufficient
   - Recommendation: Keep `@end` optional but allow it for clarity

---

## Conclusion

The v2 syntax provides:

- **One unified pattern** for all directives
- **Proper typed arguments** with first-class list support
- **Familiar function-call semantics**
- **Cleaner, more readable documents**
- **Simpler, more maintainable implementation**

The breaking changes are justified by the significant improvement in consistency, elegance, and developer/author experience.
