# LDOC

A plain-text DSL for authoring professional documents that compiles to `.docx`.

LDOC is designed for legal and structured document authoring — numbered clauses, exhibits, headers/footers, tables, cross-references — without fighting a word processor. Write in a clean directive-based syntax, compile to fully-formatted DOCX.

## Features

- **Directive-based syntax** — structured, readable, and unambiguous
- **Compiles to DOCX/OOXML** — real Word-compatible output with styles, numbering, and sections
- **Lua expressions** — computed values and templates via embedded Lua (`$(...)` and `@lua{...}`)
- **LSP server** — completions, diagnostics, and go-to-definition for editor integration
- **Includes** — split large documents across files with `@include`
- **Language-quality diagnostics** — precise error locations with recovery

## Syntax

LDOC uses three core constructs:

**Paragraph blocks** — `[...]` for text content:
```ldoc
[This is a paragraph. It can contain inline @style(bold: true){directives} and $(lua_expressions).]
```

**Directives** — `@name(args){ body }` for structure and formatting:
```ldoc
@document(title: "Service Agreement", author: "Ari")

@style(p: { use: "Heading1" })[Section 1. Definitions]

[The following terms apply throughout this agreement.]
```

**List markers** — `@-` for bullets, `@#` for numbered lists:
```ldoc
@#[Party A shall provide the services described herein.]
@#[Party B shall remit payment within 30 days of invoice.]
```

## Quick Start

```bash
# Install dependencies
bun install

# Create a new document
bun run ldoc init

# Compile to DOCX
bun run ldoc compile document.ldoc

# Compile with explicit output path
bun run ldoc compile agreement.ldoc -o output/agreement.docx

# Validate syntax
bun run ldoc validate document.ldoc

# Inspect the parse tree
bun run ldoc parse document.ldoc --json
```

## Example Document

```ldoc
@document(
  title: "Software Services Agreement",
  author: "Acme Corp",
)

@def(
  effective_date: "March 1, 2026",
)

@style(p: { use: "Heading1" })[1. Services]

[This Agreement is entered into as of $(effective_date).]

@style(p: { use: "Heading2" })[1.1 Scope of Work]

[Provider agrees to deliver the following:]

@#[Design and development of the application described in Exhibit A.]
@#[Monthly maintenance and support for a period of twelve (12) months.]
@#[Delivery of all source code upon project completion.]
```

## Architecture

```
src/
├── parse/        # Lexer + parser → CST
├── bind/         # Binder, resolver, validator
├── evaluate/     # Directive evaluator + Lua runtime
│   └── directives/  # 20+ built-in directives
├── emit/docx/    # DOCX/OOXML emitter
├── lsp/          # LSP server (completions, diagnostics, navigation)
├── pipeline/     # End-to-end compile pipeline
└── cli/          # CLI entrypoint
```

## LSP Integration

LDOC ships a Language Server Protocol server for editor integration:

```bash
bun run src/lsp/server.ts --stdio
```

Supports:
- Completion for directives and arguments
- Diagnostics with precise source locations
- Go-to-definition for `@def` variables and includes
- Hover documentation

## Status

Core compiler and DOCX emitter are complete. A decompiler (DOCX → LDOC) is planned but not yet implemented.
