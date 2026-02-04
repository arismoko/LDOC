# Neovim Tree-sitter Integration

Until tree-sitter-ldoc is upstreamed to nvim-treesitter, use this manual setup.

## Prerequisites

- Neovim 0.9+ with tree-sitter support
- [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) installed

## Installation

### 1. Register the parser

Add to your Neovim config (e.g., `~/.config/nvim/lua/config/treesitter.lua`):

```lua
local parser_config = require("nvim-treesitter.parsers").get_parser_configs()

parser_config.ldoc = {
  install_info = {
    url = "/path/to/ldoc-repo/tree-sitter-ldoc", -- local path
    files = { "src/parser.c" },
    branch = "main",
    generate_requires_npm = false,
    requires_generate_from_grammar = false,
  },
  filetype = "ldoc",
}
```

### 2. Set up filetype detection

Add to `~/.config/nvim/ftdetect/ldoc.lua`:

```lua
vim.filetype.add({
  extension = {
    ldoc = "ldoc",
  },
})
```

### 3. Copy query files

Copy the query files to your nvim-treesitter queries directory:

```bash
mkdir -p ~/.local/share/nvim/site/queries/ldoc
cp /path/to/ldoc-repo/tree-sitter-ldoc/queries/*.scm ~/.local/share/nvim/site/queries/ldoc/
```

### 4. Install the parser

In Neovim:

```vim
:TSInstall ldoc
```

Or with Lua:

```lua
require("nvim-treesitter.install").commands.TSInstall["run"]("ldoc")
```

## Verification

Open an `.ldoc` file and check:

1. **Syntax highlighting** works (keywords colored, etc.)
2. **Folding** works (try `zc` on a `@define` block)
3. **Indentation** works (press `o` after `@if`)

Run `:InspectTree` to see the parse tree.

## Troubleshooting

### Parser not found

Ensure the path in `install_info.url` is correct and the grammar is generated:

```bash
cd /path/to/tree-sitter-ldoc
tree-sitter generate
```

### Highlighting not working

Check that query files are in place:

```bash
ls ~/.local/share/nvim/site/queries/ldoc/
# Should show: highlights.scm, folds.scm, indents.scm
```

### Wrong filetype

Verify filetype detection:

```vim
:set ft?
" Should show: filetype=ldoc
```

## LSP Integration

For full language support (completion, diagnostics, go-to-definition), also configure the LSP:

```lua
-- In your LSP config
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

if not configs.ldoc then
  configs.ldoc = {
    default_config = {
      cmd = { "ldoc", "lsp" },
      filetypes = { "ldoc" },
      root_dir = lspconfig.util.root_pattern(".git", "*.ldoc"),
      settings = {},
    },
  }
end

lspconfig.ldoc.setup({})
```

Ensure `ldoc` is in your PATH:

```bash
# Build and install the CLI
bun build --compile --target=bun src/cli/index.ts --outfile ~/.local/bin/ldoc
```
