-- LDOC Language Support for Neovim
-- Copy this file to ~/.config/nvim/lua/config/ldoc.lua
-- Then add `require("config.ldoc")` to your init.lua

-- Register .ldoc filetype
vim.filetype.add({
  extension = {
    ldoc = "ldoc",
  },
})

-- Register ldoc language with Tree-sitter
-- Parser: ~/.local/share/nvim/site/parser/ldoc.so
-- Queries: ~/.local/share/nvim/site/queries/ldoc/*.scm
vim.treesitter.language.register("ldoc", "ldoc")

-- Fallback filetype detection for edge cases
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = "*.ldoc",
  callback = function(args)
    if vim.bo[args.buf].filetype == "" then
      vim.bo[args.buf].filetype = "ldoc"
    end
  end,
})

-- LSP setup on FileType
vim.api.nvim_create_autocmd("FileType", {
  pattern = "ldoc",
  callback = function(args)
    local root_dir = vim.fs.root(args.buf, { ".git", "package.json" }) or vim.fn.getcwd()

    -- Build capabilities (with completion support)
    local capabilities = vim.lsp.protocol.make_client_capabilities()

    -- Integrate with blink.cmp if available
    local ok_blink, blink = pcall(require, "blink.cmp")
    if ok_blink and type(blink.get_lsp_capabilities) == "function" then
      capabilities = blink.get_lsp_capabilities(capabilities)
    end

    -- Integrate with nvim-cmp if available
    local ok_cmp, cmp_lsp = pcall(require, "cmp_nvim_lsp")
    if ok_cmp and type(cmp_lsp.default_capabilities) == "function" then
      capabilities = vim.tbl_deep_extend("force", capabilities, cmp_lsp.default_capabilities())
    end

    -- Determine command: prefer binary, fall back to bun
    local cmd
    if vim.fn.executable("ldoc") == 1 then
      cmd = { "ldoc", "lsp" }
    else
      cmd = { "bun", "run", "ldoc", "lsp" }
    end

    -- Start LSP
    vim.lsp.start({
      name = "ldoc",
      cmd = cmd,
      root_dir = root_dir,
      cmd_cwd = root_dir,
      capabilities = capabilities,
    })

    -- Enable omnifunc for basic completion without plugins
    vim.bo[args.buf].omnifunc = "v:lua.vim.lsp.omnifunc"
  end,
})
