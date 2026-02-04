# LDOC CLI Reference

The `ldoc` command-line tool is your primary interface for compiling, decompiling, and managing LDOC documents.

## Installation

=== "Binary (Recommended)"
    ```bash
    # Download or build the standalone binary
    bun build --compile --target=bun src/cli/index.ts --outfile ~/.local/bin/ldoc
    ```

=== "Bun Run"
    ```bash
    # Run directly from source
    bun run ldoc <command> [args]
    ```

---

## Primary Commands

### `compile`
Compiles an `.ldoc` file to a professional `.docx` document.

```bash
ldoc compile input.ldoc -o output.docx
```

!!! tip
    You can use the shorthand `ldoc input.ldoc` to quickly compile a file using default settings.

### `decompile`
Converts an existing `.docx` file back to `.ldoc`.

```bash
ldoc decompile input.docx -o output.ldoc
```

!!! warning "Lossy Conversion"
    Decompilation is a "best effort" process. While text and structure are preserved, complex Word-specific formatting may require manual adjustment in the resulting `.ldoc` file.

---

## Development Tools

### `watch`
Automatically recompiles your document whenever you save the `.ldoc` source.

```bash
ldoc watch agreement.ldoc
```

!!! note
    Requires `fswatch` to be installed on your system.

### `fmt`
Auto-formats your LDOC source code to maintain consistency.

```bash
# Preview changes
ldoc fmt agreement.ldoc

# Write changes back to file
ldoc fmt agreement.ldoc -w
```

### `parse`
Outputs the Abstract Syntax Tree (AST). Highly useful for debugging complex templates or reporting issues.

```bash
ldoc parse agreement.ldoc --json
```

---

## Quality Assurance

### `validate`
Checks your document for syntax errors without compiling.

```bash
ldoc validate agreement.ldoc
```

### `diff`
Performs a semantic diff between two LDOC files, ignoring trivial whitespace changes.

```bash
ldoc diff version1.ldoc version2.ldoc
```

---

## Editor Support

### `lsp`
Starts the LDOC Language Server.

!!! info "VS Code & Neovim"
    Configure your editor to use `ldoc lsp` to get real-time diagnostics, autocompletion, and hover information while you write.
