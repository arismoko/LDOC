Below is a **complete updated LDOC v3 spec (Draft)** that incorporates everything we’ve agreed on: explicit `[]` paragraphs (single-paragraph blocks), JSON5-style args with **implicit object** inside `(...)`, Lua as the evaluation engine using **`$(...)`** for expressions and **`@lua{...}`** for statement chunks, style channels (`p` vs `r`), list markers, tables that no longer collide with `[]`, and **language-quality diagnostics + recovery**.

---

# LDOC v3 Specification (Draft, Updated)

Status: Draft for review

LDOC is a plain-text language for authoring professional documents (legal-first). It compiles primarily to DOCX/OOXML while preserving legal drafting structure (numbered clauses, exhibits, tables, signatures, headers/footers). LDOC is designed to be extendable to other targets (e.g., HTML) without changing the authoring model.

This spec prioritizes:

- One clear way to write structure (**no indentation scoping**)
- Predictable legal list numbering
- JSON5-friendly args without inventing a mini-YAML parser
- Lua-based evaluation for computed values and templates
- Language-quality diagnostics and error recovery

---

## 1. Terminology

The keywords MUST, SHOULD, and MAY are to be interpreted as described in RFC 2119.

- **Directive**: an `@name(...)` construct that controls structure/layout/formatting.
- **Body**: content attached to a directive, delimited by `{ ... }` (structural or inline depending on context).
- **Paragraph block**: `[...]`, exactly one paragraph.
- **Marker**: a line prefix that begins a list item (`@-`, `@#`, and deeper variants).
- **Expression**: `$( ... )` Lua expression (implicit return).
- **Lua block**: `@lua{ ... }` Lua statement chunk.
- **Args**: content inside `(...)`, parsed as an **implicit JSON5 object member list**.

---

## 2. Contexts (the “3-context rule”)

LDOC parsing is context-sensitive in a controlled way.

### 2.1 Structural context

Where: top-level, and inside directive structural bodies `{ ... }`.

Contains:

- paragraph blocks `[...]`
- directives `@...`
- list markers at start-of-line
- tables, layout directives, nested structure
- (optionally) cross-reference syntax

### 2.2 Paragraph context

Where: inside a paragraph block `[...]`, and inside inline directive bodies within a paragraph.

Contains:

- text
- inline directives
- expressions `$(...)`

MUST NOT contain:

- nested paragraph blocks `[...]`
- list markers
- structural-only table/layout blocks (unless explicitly allowed)
- block comments (comments are literal in paragraphs)

### 2.3 Args context

Where: inside directive arguments `(...)`.

Contains:

- an implicit JSON5 object body (member list)
- JSON5 conveniences (unquoted keys, trailing commas, comments)

---

## 3. Encoding, Comments, Escapes

### 3.1 Encoding

Processors MUST accept UTF-8 input.

### 3.2 Comments

- In **structural context**, line comments begin with `//` and run to end-of-line.
- In **paragraph context**, `//` is literal text.
- In **args context**, comments follow JSON5 rules (e.g., `//` and `/* */` MAY be allowed if the JSON5 parser supports them).

### 3.3 Escapes (paragraph + inline bodies)

In paragraph context and inline directive bodies, implementations MUST recognize:

- `\\` → `\`
- `\[` → `[`
- `\]` → `]`
- `\@` → `@`
- `\{` → `{`
- `\}` → `}`
- `\(` → `(`
- `\)` → `)`
- `\$` → `$` (useful to write literal `$(` without starting an expression)

Unknown `\X` sequences SHOULD be treated as literal `\X`.

---

## 4. Paragraph Blocks

### 4.1 Syntax

A paragraph is written as a paragraph block:

```ldoc
[This is a paragraph.]
```

### 4.2 Rules

- `[...]` is **exactly one paragraph**.
- Paragraph blocks MUST NOT be nested.

### 4.3 Newline normalization (Markdown-friendly, Word-first)

Inside `[...]`, newlines are normalized to support soft-wrap authoring:

**Trimming**

- If the first character after `[` is a newline, implementations MUST remove exactly one leading newline.
- If the last character before `]` is a newline, implementations MUST remove exactly one trailing newline.

**Normalization**
After trimming:

- A single newline (`\n`) MUST be treated as a **soft wrap** and rendered as a **single space**.
- A run of `N >= 2` consecutive newlines MUST be rendered as **`N - 1` hard line breaks** inside the paragraph (Word “Shift+Enter”).

Examples (conceptual):

- `TEXT\nTEXT` → `TEXT TEXT`
- `TEXT\n\nTEXT` → `TEXT` + 1 hard break + `TEXT`
- `TEXT\n\n\nTEXT` → `TEXT` + 2 hard breaks + `TEXT`

Implementations SHOULD avoid producing double spaces when converting a soft-wrap newline into a space.

---

## 5. Directives

### 5.1 General form

A directive begins with `@` followed by a name.

Forms:

- `@name`
- `@name(args...)`
- `@name{ body }`
- `@name(args...){ body }`
- `@name[ paragraph ]` (syntactic sugar; see §5.5)

Whitespace between name, args, and body MAY appear.

### 5.2 Directive names

Directive names are ASCII identifiers:

- `[A-Za-z_][A-Za-z0-9_-]*`

(List markers `@-` and `@#` are not identifiers.)

### 5.3 Bodies are context-sensitive

`{ ... }` bodies parse differently depending on the surrounding context:

- In **structural context**, `@name{...}` is a **structural body** containing structural blocks (paragraphs, markers, directives, tables, etc.).
- In **paragraph context**, `@name{...}` is an **inline body** containing paragraph content (text, `$(...)`, inline directives).

This is a core rule: the parser always knows which context it is in.

### 5.4 Unknown directives

Unknown directives MUST produce diagnostics (see §16) and compilation MUST recover and continue.

Recovery strategy is implementation-defined; RECOMMENDED behavior:

- Treat unknown directives as no-ops that still parse their args/body, to avoid cascading parse failures.

### 5.5 Sugar: paragraph-body directive form

`@name[ ... ]` is syntactic sugar for:

```ldoc
@name{ [ ... ] }
```

This sugar is OPTIONAL for v3, but RECOMMENDED because it is convenient and unambiguous.

---

## 6. Directive Arguments (Implicit JSON5 Object)

### 6.1 Canonical args syntax

Directive args are written inside `(...)` as a JSON5 object **member list**, with the outer `{}` implied:

```ldoc
@style(p: { use: "Heading1" }, r: { bold: true })
```

Semantics:

- The args text inside `(...)` is parsed as if it were `{ <argsText> }`.

### 6.2 Values

Args values are JSON5 values:

- string, number, boolean, null
- array `[...]`
- object `{...}`

**Lengths** MUST be represented as strings (to avoid custom unit lexing):

- `"0.5in"`, `"12pt"`, `"720twip"`

### 6.3 No bare flags in v3 core

To keep args strictly JSON5, “bare identifiers as flags” are not part of v3 core.

Write:

```ldoc
@columns(count: 2, gap: "0.5in", separator: true)
```

### 6.4 Args diagnostics and recovery

If args parsing fails:

- The implementation MUST emit a diagnostic tied to the args range.
- The implementation MUST preserve the raw args text on the node.
- The implementation MUST recover and proceed as if args were `{}` (empty object) to continue parsing and find additional errors.

---

## 7. Lua Evaluation

LDOC embeds Lua for computation at compile-time.

### 7.1 Expression form: `$( ... )`

`$( ... )` is a Lua **expression**.

Rules:

- Contents inside `$(...)` MUST be parsed/evaluated as a Lua expression (not a full chunk).
- Implementations MUST apply **implicit return** by evaluating as if wrapped in:
  - `return (<expr>)`

- Expressions may appear anywhere in paragraph context (and in certain value contexts, see below).

Example:

```ldoc
[Default font size is $(data.font_size_pt) pt.]
```

### 7.2 Lua statement blocks: `@lua{ ... }`

`@lua{ ... }` contains Lua **statements**.

Rules:

- `@lua{...}` is only valid in structural context.
- The body is a Lua chunk executed in the evaluator environment.

Example:

```ldoc
@lua{
  -- compute helper values
  defs.exhibitTitle = "EXHIBIT " .. data.exhibit_letter
}
[Title: $(defs.exhibitTitle)]
```

> Note: `@lua{}` uses `{}` which also appears in Lua table literals. Implementations MUST parse the Lua block with balanced brace scanning that respects Lua strings and comments, so nested `{}` in Lua tables do not prematurely end the block.

### 7.3 Value vs text contexts

Expressions can produce different kinds of values depending on where they are used.

**Text context** (inside `[...]` or inline directive body in a paragraph):

- The value MUST be coerced to string (e.g., Lua `tostring`), and inserted as text.

**Value context** (see §9 `@def`, and any directive args mechanism that evaluates expressions):

- The value MUST be JSON-like:
  - string / number / boolean / nil
  - table-as-array or table-as-object

- If a value is not representable (function, userdata, thread), implementations MUST produce a diagnostic and recover (recommended: treat as null).

### 7.4 Sandbox and safety requirements

Implementations MUST provide:

- a sandboxed Lua environment (no unrestricted filesystem/network/process access)
- an instruction limit and/or wall-clock timeout
- recovery when evaluation times out or errors

---

## 8. Data Model: `data`, `defs`, `styles`

The evaluator environment MUST provide:

- `data`: external input data (implementation-defined shape)
- `defs`: LDOC-defined bindings (see §9), mutable in Lua unless disallowed
- `styles`: core and user style objects (see §10)

Implementations SHOULD provide core helper functions under a namespace (e.g., `ldoc.*`) rather than polluting globals.

---

## 9. Definitions: `@def(...)`

### 9.1 Canonical definition form (multiple bindings)

`@def(...)` defines one or more bindings where each key becomes a name.

```ldoc
@def(
  exhibitTitle: $("EXHIBIT " .. data.exhibit_letter),
  h1: { p: { use: "Heading1" } },
  strong: { r: { bold: true } },
)
```

Rules:

- Keys MUST be valid identifiers.
- Values are JSON5 values OR `$(...)` expressions (value context).
- Duplicate keys within a single `@def` MUST be an error.

### 9.2 Scope

Scope rules are implementation-defined; RECOMMENDED:

- `@def` at top-level defines document-global bindings.
- `@def` inside an included file or directive body defines bindings in that local scope.

Implementations MAY model scope by creating nested evaluator environments where lookups fall back to parent scope.

---

## 10. Styling

### 10.1 Style channels

Style objects support two channels:

- `p`: paragraph properties / paragraph style selection
- `r`: run properties / character formatting

Examples:

```ldoc
@def(
  h1: { p: { use: "Heading1" }, r: { bold: true, size: 28 } },
  strong: { r: { bold: true } },
)
```

### 10.2 Applying styles with `@style`

`@style(...)` applies styling.

Paragraph application:

```ldoc
@style(p: { use: "Heading1" })[Payment Terms]
```

Inline run application:

```ldoc
[This is @style(r: { italic: true }){important}.]
```

### 10.3 Context rules

- When `@style` applies to a paragraph block, both `p` and `r` are meaningful.
- When `@style` applies inline inside a paragraph, only `r` is meaningful.
  - Supplying `p` inline SHOULD produce a warning.

### 10.4 Referencing style definitions

Implementations SHOULD support referencing named style bindings:

```ldoc
@style(ref: "h1")[Non-Disclosure Agreement]
[This is @style(ref: "strong"){important}.]
```

Resolution:

- `ref` MUST refer to a binding containing a style object.

---

## 11. Lists (Key Feature)

### 11.1 Markers and depth

List items begin with markers at start-of-line in structural context.
Nesting depth is determined by the number of leading `@` characters.

- Bullets: `@-`, `@@-`, `@@@-`, ...
- Ordered: `@#`, `@@#`, `@@@#`, ...

### 11.2 Numbering mode

Numbering mode is configured at document level:

```ldoc
@document(numbering: { mode: "tiered" })
```

Modes:

- `tiered` (default): `1.`, `1.1.`, `1.1.1.`, ...
- `legal` (optional): `1.`, `(a)`, `(i)`, `(A)`, ...

### 11.3 Marker args

Markers MAY take args using the same args syntax:

```ldoc
@#(start: 5)[Start at 5]
@#(continue: true)[Continue numbering]
```

Rules:

- `start` and `continue` are mutually exclusive.
- Marker args SHOULD appear on the first item of a new ordered block.

### 11.4 Item bodies

List items MUST be written in one of these forms:

**Single-paragraph item (recommended sugar form):**

```ldoc
@#[One paragraph list item.]
@-[Bullet item.]
```

**Multi-paragraph item:**

```ldoc
@#{
  [First paragraph of the item.]
  [Second paragraph of the same item.]
}
```

### 11.5 Marker safety

Markers SHOULD be recognized only at start-of-line (after optional whitespace) to avoid accidental parsing of `@mentions`.

---

## 12. Tables

Because `[...]` is reserved for paragraphs, table rows MUST NOT use `[...]` row syntax.

### 12.1 Syntax

Tables are declared using `@table{ ... }` and rows using `@row(...)`:

```ldoc
@table{
  @row(cells: ["Item", "Seller Pays", "Buyer Pays"])
  @row(cells: ["Title Commitment", "X", ""])
  @row(cells: ["Recording Fee", "", "X"])
}
```

### 12.2 Cell merging

Within `cells`, the following string tokens have special meaning:

- `">"` merges with the cell to the left (colspan)
- `"^"` merges with the cell above (rowspan)

```ldoc
@table{
  @row(cells: ["Header 1", ">", "Header 3"])
  @row(cells: ["Row 1", "Cell 2", "Cell 3"])
  @row(cells: ["Row 2", "^",      "Cell 3"])
}
```

Implementations MAY add an explicit `@cell(...)` form later for literal `">"` and `"^"` content.

---

## 13. Layout Directives (Core)

### 13.1 Page break

```ldoc
@pagebreak
```

### 13.2 Columns

```ldoc
@columns(count: 2, gap: "0.5in", separator: true){
  [Left column content.]
  @break
  [Right column content.]
}
```

`@break` is only meaningful inside `@columns`.

### 13.3 Box

```ldoc
@box{
  [NOTICE: Important information.]
}
```

### 13.4 Alignment

```ldoc
@align(value: "center"){
  @style(ref: "h1")[EXHIBIT A]
}
```

Implementations MAY provide shorthands later (`@center{...}`, `@right{...}`).

---

## 14. Headers and Footers

Headers/footers use structural content with region directives:

```ldoc
@header{
  @left[Mutual NDA]
  @right[Page $(page) of $(pages)]
}

@footer{
  @center[Confidential]
}
```

`page` and `pages` are implementation-defined values provided by the emitter during compilation for DOCX targets.

---

## 15. Cross-References

### 15.1 Anchors

```ldoc
@anchor(id: "payment-terms")
@style(ref: "h1")[Payment Terms]
```

### 15.2 References

Cross-references use the `@ref` inline directive:

```ldoc
[See @ref(id: "payment-terms") for details.]
```

With optional display text:

```ldoc
[See @ref(id: "payment-terms"){Payment Terms} for details.]
```

When no body is provided, implementations SHOULD generate display text from the anchor context (e.g., heading text or anchor ID).

Resolution rules are implementation-defined (heading-text references and/or explicit IDs).

---

## 16. Composition (File Includes)

### 16.1 Declaring parameters

Parameters are declared as JSON5 args:

```ldoc
@params(names: ["name", "title"])
```

### 16.2 Including a file

```ldoc
@include(
  path: "clauses/signature.ldoc",
  args: { name: "Michael Powell", title: "Grantor" }
)
```

Rules:

- If a file declares `@params`, the include MUST provide those names in `args`.
- Include parameters create a local scope for that file.
- Includes SHOULD be pure: included files SHOULD NOT mutate caller state (unless explicitly allowed).

---

## 17. Error Handling Requirements (Language-quality diagnostics)

An implementation MUST:

### 17.1 Produce diagnostics with:

- severity (`error` | `warn` | `info`)
- message
- source range (start/end offsets)

### 17.2 Recover from:

- malformed args objects
- unknown directives
- unterminated `[...]`, `(...)`, `{...}`, `$(...)`, `@lua{...}`
- mismatched delimiters

### 17.3 Continue parsing

Implementations MUST continue parsing to find additional errors (“don’t stop at first error”).

### 17.4 Recommended recovery strategy

- If a block opener is unterminated, treat EOF as the closer and continue.
- If args parsing fails, keep raw args text and proceed with `{}` as fallback.
- If `$(...)` is unterminated, treat EOF as `)` and continue.
- If `@lua{...}` is unterminated, treat EOF as `}` and continue.

### 17.5 Evaluation errors

Lua runtime errors/timeouts MUST be surfaced as diagnostics with accurate source ranges for the originating `$(...)` or `@lua{...}` span. Compilation SHOULD recover (recommended: treat the expression value as empty string or null, depending on context).

---

## 18. Compiler Pipeline (Idiomatic)

Recommended stages:

1. **Lex / Parse** → CST or AST-with-spans (must recover)
2. **Desugar** → expand sugars (e.g., `@name[...]` → `@name{[...]}`)
3. **Bind / Resolve** → bindings (`@def`), directive lookup, anchors/refs
4. **Evaluate** → run `$()` and `@lua{}` in a sandbox (with timeouts)
5. **Normalize / Validate** → list numbering rules, style resolution, table spans
6. **Emit** → DOCX (primary), others later

---

## 19. Deferred / Non-Goals (for v3 core)

- Markdown headings (`#`) and inline emphasis (`**bold**`, etc.) are deferred (may be added as pure sugar later).
- Dynamic “Lua-defined directives” (metamethod directives, user-defined directive surfaces) are deferred; directives are static/registered for LSP and diagnostics quality.
- Control flow directives (`@if`, `@for`) are deferred until scoping + evaluation semantics are finalized (they can be reintroduced later powered by Lua).
- Typed include params (e.g. `@params(name: "string")`) are deferred; v3 core uses name-list params only (`@params(names: [...])`).
- Expression-valued args (direct `$(...)` inside directive args objects) are deferred for v3 core.

### 19.1 Tracking deferred sugar and UX ideas

Implementations SHOULD keep a separate backlog document (for example, `SUGAR_BACKLOG.md`) for non-normative sugar/UX proposals.

Rules:

- The spec defines what is guaranteed now.
- The backlog tracks what may be added later.
- Backlog items MUST include desugaring target and diagnostic behavior before graduation to core.

### 19.2 Candidate sugar/UX backlog categories (non-normative)

- Directive aliases (for example `@center{...}` sugar for `@align(value: "center"){...}`).
- Inline emphasis sugar mapped to existing style channels.
- Typed include param contracts and optionality (`?`) semantics.
- Expression args wrappers and evaluation timing rules.
- Quality-of-life diagnostics (unknown directive suggestions, fix-it hints for misplaced region directives).

---

## 20. Full Example (Updated)

```ldoc
@document(
  title: "Mutual NDA",
  margins: "1in 1in 1in 1.25in",
  numbering: { mode: "tiered" },
)

@def(
  h1: { p: { use: "Heading1" } },
  strong: { r: { bold: true } },
  exhibitTitle: $("EXHIBIT " .. data.exhibit_letter),
)

@style(ref: "h1")[Non-Disclosure Agreement]

[This Agreement is between $(data.party_a.name) and $(data.party_b.name) (the "Parties").]

@#{
  [Definitions]
  @@#[“Confidential Information” means any non-public information...]
  @@#[“Term” means the period starting on $(data.effective_date).]
}

@pagebreak

@align(value: "center"){
  @style(ref: "h1")[Signatures]
}

@include(
  path: "clauses/signature.ldoc",
  args: { name: "Michael Powell", title: "Grantor" }
)
```

For v3 core, directive args are JSON5 values only. Direct `$(...)` values inside args are deferred and tracked as future sugar (see §19).
