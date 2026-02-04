# Editor Support (Neovim, VS Code, Helix)

This repo already has the core ingredients for first-class editor support:

- A real parser + AST (`src/parser/**`)
- A formatter (`src/formatter/index.ts` via `ldoc fmt`)
- An LSP server entrypoint (`ldoc lsp`, implemented in `src/lsp/server.ts`)
- A Tree-sitter grammar scaffold (`tree-sitter-ldoc/`)

What we do not have yet is a cohesive, modern distribution and a semantic layer in the LSP that can power *good* autocompletion.

This document is the plan to make LDOC feel like a modern, polished language in editors.

## Goals

- Great completions:
  - directives (`@...`) with context and snippets
  - `@document` keys and nested shapes
  - macro names + parameters for `@use`
  - variables (from `@meta`, `@set`, loop vars, imported symbols)
  - anchors for `[[...]]` and link targets
- Fast + stable:
  - no typing lag in large documents
  - deterministic, testable behavior
- Easy install:
  - Neovim: Tree-sitter + LSP + completion UI
  - VS Code: extension bundles the server
  - Helix: tree-sitter + external LSP

## Non-goals (for v1)

- Full type system for expression language
- Refactoring-grade rename across a project (we can add later)
- Perfect incremental parsing (we can get 90% value without it)

## Current State (Reality Check)

### LSP (`src/lsp/server.ts`)

- Transport: stdio (`createConnection(ProposedFeatures.all)`)
- Diagnostics: parse errors only (push via `sendDiagnostics`)
- Definition: only a rough heuristic for markdown-style `(#anchor)` links; AST has no end positions
- Completion: hard-coded list of a few directives; no context; no trigger characters

### Tree-sitter (`tree-sitter-ldoc/`)

- Exists, but is out of sync with the real language surface area.
- Still includes legacy directives that the TS lexer treats as errors.
- Queries only cover basic highlighting.

We intentionally do not ship a regex-based Vim syntax fallback. Neovim support is Tree-sitter-first.

## Strategy

1. Tree-sitter is the syntax backbone (highlighting/indent/folds/textobjects).
2. LSP is the semantic brain (completion, navigation, diagnostics, formatting).
3. Maintain alignment via a shared corpus and CI gates.
4. Distribute the experience via:
   - snippets/config for early adopters
   - small glue plugins (optional)
   - upstream integrations (best end-state)

## Roadmap

### Phase 0: Make the language mappable (positions + corpus)

Why: good completion and go-to-definition require accurate ranges.

- Add end positions to AST nodes (or add byte offsets and compute ranges).
  - Today AST nodes only have `{ line, column }`.
  - Target: `{ line, column, endLine, endColumn }` on every node.
- Add a corpus folder with representative `.ldoc` files that cover:
  - `@document`, `@meta`, `@import`
  - templates: `@define`, `@use`, `@slot`
  - control flow: `@if/@elseif/@else/@end`, `@repeat`, `@foreach`, `@set`
  - inline: variables + filters, crossrefs, links/images/footnotes/inline code/strikethrough
  - tables with `>`/`^` merges
- CI gate: corpus parses via TS parser; formatter round-trips; Tree-sitter parses the same corpus.

Deliverables

- `tests/corpus/*.ldoc`
- corpus test runner (Bun tests)
- AST position upgrade (TS)

### Phase 1: Tree-sitter alignment + modern queries

Why: editor highlighting/indent/folding should not lie.

- Update `tree-sitter-ldoc/grammar.js` to reflect the actual language.
  - Add missing constructs (notably control flow and inline features).
  - Remove legacy directives that are errors in TS lexer.
- Expand query set:
  - `tree-sitter-ldoc/queries/highlights.scm`
  - add `indents.scm`, `folds.scm`, `locals.scm` (as needed)

Deliverables

- Tree-sitter corpus tests (`tree-sitter test` + repo-level corpus)
- Neovim Tree-sitter integration instructions (until upstreamed)

### Phase 2: LSP v1 semantics (completion, hover, definition)

Why: this is where "good autocompletion" lives.

Core refactor

- Build a real per-document symbol index during validation:
  - anchors (`@anchor` and any implicit anchors)
  - macros (`@define` name, params, defaults)
  - macro uses (`@use` name, args)
  - variables:
    - declared in `@meta`
    - assigned via `@set`
    - loop vars from `@foreach`
  - `@document` keys (and nested shapes)
  - imports (`@import`) for cross-file symbol availability
- Store this in cache keyed by URI (replaces the current anchors-only cache).

Completion (what "good" looks like)

- Trigger characters: `@`, `{`, `[`, `(` (and space in some contexts).
- Context detection (cheap text heuristics first; AST-based later):
  - after `@` -> directive completion
  - in `@document` block -> key completion + snippets
  - in `@meta` block -> key completion + common patterns
  - in `@use <Name>(...)` -> macro name + param keys + value snippets
  - inside `{{ ... }}` -> variable path completion + filters (`| upper`, etc.)
  - inside `[[ ... ]]` -> anchor completion
- Snippet insertText for the high-friction constructs:
  - `@if ${1:condition}\n\t${0}\n@end`
  - `@foreach ${1:item} in ${2:items}\n\t${0}\n@end`
  - `@define ${1:Name}(${2:params})\n\t${0}\n@end`
  - `@use ${1:Name}(${2:key}=${3:value})`
- Use `completionItem/resolve` for heavy docs, keep initial completion fast.

Navigation

- `textDocument/definition`:
  - `[[anchor]]` -> `@anchor`
  - `@use` -> `@define`
  - `{{var}}` -> nearest defining `@meta` key or `@set` assignment (with clear rules)
- Add `textDocument/references` for anchors/macros/variables once ranges are reliable.

Formatting

- Implement `textDocument/formatting` by calling the existing formatter (`src/formatter/index.ts`).
- Optionally implement `textDocument/rangeFormatting` later.

Diagnostics

- Keep parse errors.
- Add semantic diagnostics (warnings) once symbol table exists:
  - unknown anchor `[[...]]`
  - unknown macro `@use`
  - missing required macro params
  - unknown variable paths (best-effort; avoid too many false positives)

Deliverables

- New `src/lsp/*` modules (symbol table, completion engine)
- Completion test suite (golden completions for cursor contexts)

### Phase 3: Workspace + imports (cross-file completions)

Why: real documents get split into libraries of templates.

- Implement import resolution in the LSP:
  - reuse existing resolver logic (`src/import/resolver.ts`)
  - maintain a workspace index of macros/anchors exported by files
  - include imported symbols in completions + navigation
- Watch imported files (or rebuild index lazily on open/change).

Deliverables

- cross-file completions for `@use`, `[[...]]`, and variables

### Phase 4: Distribution (make it easy to install)

Neovim

- Recommended stack:
  - `nvim-treesitter` (syntax)
  - `nvim-lspconfig` (LSP wiring)
  - `nvim-cmp` + `cmp-nvim-lsp` (completion UI)
  - optional: `conform.nvim` (format-on-save via CLI) if users prefer not to use LSP formatting
- Provide one of:
  - a copy/paste snippet in docs (lowest maintenance), or
  - a tiny `ldoc.nvim` glue plugin that:
    - registers filetype
    - registers the Tree-sitter parser config
    - configures LSP `cmd = { "ldoc", "lsp" }`

VS Code

- Create a VS Code extension that bundles the language server.
- Ship:
  - syntax highlighting (TextMate as fallback)
  - LSP client wiring
  - formatter hook
  - snippets

Helix

- Provide `languages.toml` + Tree-sitter config notes.

Packaging

- Make a stable, installable server command:
  - preferred: ship an `ldoc` executable with `ldoc lsp` (via `bun build --compile`)
  - also allow `bunx ldoc lsp` for dev

## Implementation Notes (LSP)

### Performance rules

- Keep `textDocument/completion` fast: cheap items + `data`, heavy docs in resolve.
- Debounce diagnostics on `didChange`.
- Avoid full-project scans on every keystroke.

### Position encoding

Editors may speak UTF-16 positions. If we ever compute ranges via byte offsets, we must negotiate `positionEncodingKind` (LSP 3.17+) or implement conversion.

### Testing

- Add unit tests for:
  - completion contexts (cursor-in-line fixtures)
  - definition resolution
  - formatting is stable (idempotent)

## Quickstart (target end-state)

Neovim (user-facing)

- Install Tree-sitter parser (once it is published/upstreamed).
- Install LSP server (binary or npm).
- Enable LSP and completion UI.

VS Code (user-facing)

- Install extension.
- Completions + format-on-save work automatically.

## Tracking

We should treat editor tooling as a first-class product surface:

- Every new syntax feature requires:
  - parser support
  - Tree-sitter update + queries
  - LSP completion/navigation update (if applicable)
  - corpus fixtures
