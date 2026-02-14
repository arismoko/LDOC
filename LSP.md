Absolutely — here’s a **concise, spec-style Neovim Integration Specification** for LDOC v3. This is not an implementation plan yet; it defines **what must exist and how the pieces relate**, the same way your core language spec does.

You can treat this as a companion document: _LDOC v3 Neovim Support Requirements_.

---

# LDOC v3 Neovim Integration Specification (Draft)

## 1. Scope

This document defines the minimum required editor integration behavior for LDOC v3 in Neovim.

The integration consists of:

- An LDOC Language Server (LDOC LSP)
- Tree-sitter-based syntax parsing and language injection
- Optional runtime stub generation for Lua completion

This spec intentionally avoids implementation details.

---

## 2. Editor Architecture

Neovim support MUST use a multi-language model:

| Component               | Responsibility                                                    |
| ----------------------- | ----------------------------------------------------------------- |
| **LDOC LSP**            | LDOC parsing, diagnostics, symbol resolution, directive contracts |
| **Lua Language Server** | Lua completions, hover, signature help inside embedded Lua        |
| **Tree-sitter (LDOC)**  | Structural parsing and language injection                         |
| **Tree-sitter (Lua)**   | Parsing embedded Lua regions                                      |

LDOC LSP MUST NOT attempt to provide Lua language features.

Lua language features MUST be delegated to a standard Lua LSP.

---

## 3. Embedded Lua Regions

The following LDOC constructs MUST be treated as embedded Lua:

### 3.1 Lua expressions

```ldoc
$( <lua-expression> )
```

### 3.2 Lua statement blocks

```ldoc
@lua{ <lua-statements> }
```

### 3.3 Injection requirements

Tree-sitter MUST mark the contents of:

- `$(` … `)` as `lua`
- `@lua{` … `}` as `lua`

so that Neovim routes language features to Lua LSP.

Balanced scanning MUST respect Lua strings and comments.

---

## 4. Lua Runtime Globals for Completion

Lua completion MUST expose the following globals:

| Name     | Meaning                     |
| -------- | --------------------------- |
| `data`   | External input data         |
| `defs`   | LDOC-defined bindings       |
| `styles` | Core and user style objects |
| `ldoc`   | Optional helper namespace   |

These globals MUST be visible to Lua LSP via static stubs.

---

## 5. Runtime Stub File

### 5.1 Purpose

A Lua stub file MUST exist solely for Lua LSP indexing (not execution).

### 5.2 Location

Implementations SHOULD place stubs in a project-local directory, e.g.:

```
.ldoc/ldoc_runtime.lua
```

### 5.3 Minimum content

The stub MUST define globals for Lua LSP:

```lua
---@type any
data = data

---@type table<string, any>
defs = defs

---@type table<string, any>
styles = styles
```

### 5.4 Typed stubs (recommended)

Implementations SHOULD generate structured annotations based on:

- known core styles
- `@def(...)` bindings
- optional user-provided data schema

to improve completion and hover.

---

## 6. LSP Responsibilities

### 6.1 LDOC LSP MUST provide

- syntax diagnostics (unterminated blocks, malformed args, mismatched delimiters)
- directive contract validation
- `@def` symbol indexing (go-to-definition, rename, hover)
- cross-reference diagnostics (if supported)
- Lua evaluation errors surfaced as diagnostics

### 6.2 LDOC LSP MUST NOT

- parse Lua deeply
- provide Lua completion or hover
- execute Lua for completion

---

## 7. Evaluation Feedback Loop

Implementations SHOULD:

- run the LDOC compiler/evaluator on change (debounced)
- surface semantic and Lua runtime errors as diagnostics
- enforce Lua timeouts and instruction limits

Execution MUST NOT block editor responsiveness.

---

## 8. Formatting Support (Optional)

Implementations MAY provide:

- automatic formatting for Lua regions using a Lua formatter (e.g., stylua)
- formatting for LDOC structural syntax

Formatting behavior is outside core requirements.

---

## 9. Non-Goals

The Neovim integration explicitly does NOT require:

- support for editors other than Neovim
- dynamic Lua-defined directives
- real-time Lua execution for completion
- editor-managed state persistence

---

## 10. Compliance

An LDOC Neovim integration is compliant if:

- `$()` and `@lua{}` regions are treated as Lua by Tree-sitter
- Lua completion functions correctly via Lua LSP
- LDOC LSP provides language-quality diagnostics and symbol resolution
- Lua globals (`data`, `defs`, `styles`) are visible in completion

---

If you’d like, next we can:

✅ Freeze the core spec
✅ Freeze this Neovim spec
➡️ Then write a clean **Integration Plan / Roadmap** (what to build first, what can be reused, what gets thrown out)

And after that: prototype phases (parser → LSP → emitter).
