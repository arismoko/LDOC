# LDOC Neovim Setup

This guide covers setting up LDOC language support in Neovim with Tree-sitter highlighting and LSP.

## Prerequisites

- Neovim 0.10+ (for native LSP and Tree-sitter)
- The `ldoc` CLI installed and in your PATH

### Installing the CLI

```bash
# From the ldoc repo directory:
bun build --compile --target=bun src/cli/index.ts --outfile ~/.local/bin/ldoc
```

Or if you prefer to run via Bun:

```bash
# The config below will fall back to `bun run ldoc lsp` if `ldoc` isn't found
```

## Quick Setup

Copy `ldoc.lua` from this directory to your Neovim config:

```bash
# For a standard Neovim config
cp editors/ldoc.lua ~/.config/nvim/lua/config/ldoc.lua

# Then require it in your init.lua:
# require("config.ldoc")
```

## Tree-sitter Parser

The Tree-sitter parser provides syntax highlighting, folding, and indentation.

### Install Parser Binary

```bash
# From the ldoc repo directory:
cd tree-sitter-ldoc
bun install
bun run generate

# Build the shared library
cc -shared -o ldoc.so -fPIC -I./src src/parser.c

# Install to Neovim's parser directory
cp ldoc.so ~/.local/share/nvim/site/parser/ldoc.so
```

### Install Queries

```bash
# From the ldoc repo directory:
mkdir -p ~/.local/share/nvim/site/queries/ldoc
cp tree-sitter-ldoc/queries/*.scm ~/.local/share/nvim/site/queries/ldoc/
```

## Manual Setup (Without ldoc.lua)

If you prefer to integrate into your existing config:

### 1. Filetype Detection

```lua
vim.filetype.add({
  extension = {
    ldoc = "ldoc",
  },
})
```

### 2. Tree-sitter Registration

```lua
vim.treesitter.language.register("ldoc", "ldoc")
```

### 3. LSP Configuration

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "ldoc",
  callback = function(args)
    local root_dir = vim.fs.root(args.buf, { ".git", "package.json" }) or vim.fn.getcwd()

    vim.lsp.start({
      name = "ldoc",
      cmd = { "ldoc", "lsp" },
      root_dir = root_dir,
    })
  end,
})
```

## Completion

The LSP server provides completions for:

- Directives (`@document`, `@define`, `@if`, etc.)
- Macro names and parameters (`@use MacroName(...)`)
- Variables (`{{variableName}}`)
- Cross-references (`[[anchor-name]]`)
- Document/meta keys

### With nvim-cmp

```lua
-- In your nvim-cmp setup, ensure 'nvim_lsp' source is enabled
sources = {
  { name = 'nvim_lsp' },
  -- ... other sources
}
```

### With blink.cmp

The included `ldoc.lua` automatically integrates with blink.cmp if available.

## Features

| Feature | Status |
|---------|--------|
| Syntax Highlighting | Tree-sitter |
| Code Folding | Tree-sitter (`folds.scm`) |
| Auto-indentation | Tree-sitter (`indents.scm`) |
| Completions | LSP |
| Go to Definition | LSP (macros, anchors, variables) |
| Find References | LSP |
| Diagnostics | LSP (parse errors + semantic warnings) |
| Formatting | LSP (`ldoc fmt`) |

## Troubleshooting

### Parser not loading

Check that the parser is in the right location:

```bash
ls ~/.local/share/nvim/site/parser/ldoc.so
```

### LSP not starting

Verify the CLI is accessible:

```bash
which ldoc
ldoc lsp  # Should block waiting for input (Ctrl+C to exit)
```

Check LSP logs in Neovim:

```vim
:LspLog
```

### Highlighting not working

Ensure queries are installed:

```bash
ls ~/.local/share/nvim/site/queries/ldoc/
# Should show: highlights.scm, folds.scm, indents.scm
```

Force Tree-sitter to recognize the parser:

```lua
:lua vim.treesitter.language.register("ldoc", "ldoc")
:e  -- Re-edit the file
```
