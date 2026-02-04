# LDOC CLI Reference

## Commands

### `compile`
Compiles an `.ldoc` file to `.docx`.

```bash
ldoc compile input.ldoc [-o output.docx]
```

### `decompile`
Converts a `.docx` file to `.ldoc`.

```bash
ldoc decompile input.docx [-o output.ldoc] [--emit-indent | --no-indent]
```

### `watch`
Watches an `.ldoc` file and recompiles on changes.

```bash
ldoc watch input.ldoc
```

### `fmt`
Formats an `.ldoc` file.

```bash
ldoc fmt input.ldoc [-w] [--spaces]
```
- `-w`: Write changes back to file.
- `--spaces`: Use 2 spaces instead of tabs.

### `diff`
Semantically compares two `.ldoc` files.

```bash
ldoc diff fileA.ldoc fileB.ldoc [--json]
```

### `validate`
Checks syntax validity.

```bash
ldoc validate input.ldoc
```

### `init`
Creates a new LDOC project.

```bash
ldoc init [directory]
```

### `lsp`
Starts the Language Server (used by editor extensions).

```bash
ldoc lsp
```
