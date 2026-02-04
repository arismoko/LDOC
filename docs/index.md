# LDOC Documentation

LDOC is a Markdown-like DSL for generating complex DOCX documents. It bridges the gap between simple Markdown and professional Word documents.

## Guide

- [Syntax Reference](syntax.md): Complete guide to LDOC syntax.
- [CLI Usage](cli.md): How to use the `ldoc` command-line tool.
- [Examples](../examples/): Example LDOC files.

## Key Features

- **Markdown-compatible**: Uses standard Markdown for text, headers, lists, and links.
- **Directives**: `@directive` syntax for advanced layout (columns, boxes, page breaks).
- **Variables**: `{{variable}}` interpolation.
- **Control Flow**: `@if`, `@foreach`, `@repeat` for dynamic content.
- **Macros**: `@define` and `@use` for reusable components.
- **Decompiler**: Convert existing DOCX files back to LDOC.
- **Diff**: Semantic diffing of LDOC files.

## Quick Start

```bash
# Install (if distributed via npm)
npm install -g ldoc

# Initialize a new project
ldoc init my-doc
cd my-doc

# Compile
ldoc compile document.ldoc
```
