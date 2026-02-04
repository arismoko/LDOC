#!/usr/bin/env bun

// CLI for Legal Document DSL

import { parse } from "../parser/parser";
import { compile } from "../compiler";
import { docxToLdoc, type DecompilerOptions, type DecompileResult } from "../decompiler";
import { format } from "../formatter";
import { diffLdoc, type Change } from "../diff";
import { startServer } from "../lsp/server";

const HELP = `
ldoc - Legal Document DSL Compiler

Usage:
  ldoc compile <input.ldoc> [-o output.docx]
  ldoc watch <input.ldoc>
  ldoc parse <input.ldoc> [--json]
  ldoc validate <input.ldoc>
  ldoc decompile <input.docx> [-o output.ldoc] [--emit-indent | --no-indent]
  ldoc fmt <input.ldoc> [-w|--write] [--spaces]
  ldoc diff <fileA.ldoc> <fileB.ldoc> [--json]
  ldoc lsp
  ldoc init [dir]

Commands:
  compile   Compile .ldoc to .docx
  watch     Watch file and recompile on changes
  parse     Parse and output AST (for debugging)
  validate  Validate .ldoc syntax (outputs JSON)
  decompile Convert .docx to .ldoc (lossy)
  fmt       Format .ldoc file (auto-format source)
  diff      Compare two .ldoc files semantically
  lsp       Start Language Server Protocol (stdio)
  init      Initialize a new LDOC project

Options:
  -o, --output      Output file path (default: <input>.docx)
  --json            Output as JSON (parse/diff commands)
  --emit-indent     Emit @indent/@outdent directives (default)
  --no-indent       Suppress @indent/@outdent directives for simpler output
  -w, --write       Write formatted output back to file (fmt command)
  --spaces          Use 2 spaces for indentation (fmt command; default is tabs)
  -h, --help        Show this help

Examples:
  ldoc compile agreement.ldoc
  ldoc compile agreement.ldoc -o output/agreement.docx
  ldoc watch agreement.ldoc
  ldoc parse agreement.ldoc --json
  ldoc validate agreement.ldoc
  ldoc decompile agreement.docx
  ldoc decompile agreement.docx -o agreement.ldoc
  ldoc decompile agreement.docx --no-indent
  ldoc fmt agreement.ldoc
  ldoc fmt agreement.ldoc -w
  ldoc diff old.ldoc new.ldoc
  ldoc diff old.ldoc new.ldoc --json
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0] ?? "";

  switch (command) {
    case "compile":
      await compileCommand(args.slice(1));
      break;

    case "watch":
      await watchCommand(args.slice(1));
      break;

    case "parse":
      await parseCommand(args.slice(1));
      break;

    case "decompile":
      await decompileCommand(args.slice(1));
      break;

    case "validate":
      await validateCommand(args.slice(1));
      break;

    case "fmt":
      await fmtCommand(args.slice(1));
      break;

    case "diff":
      await diffCommand(args.slice(1));
      break;

    case "lsp":
      startServer();
      break;

    case "init":
      await initCommand(args.slice(1));
      break;

    default:
      // Assume it's a file to compile
      if (command.endsWith(".ldoc")) {
        await compileCommand(args);
      } else if (command.endsWith(".docx")) {
        await decompileCommand(args);
      } else {
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
      }
  }
}

async function initCommand(args: string[]) {
  const targetDir = args[0] || ".";
  const { join } = await import("node:path");
  const { exists } = await import("node:fs/promises");
  
  const template = `@document
  title: "Untitled Document"
  author: "Author Name"
@end

# Introduction

This is a new LDOC document.

## Section 1

Start writing here.
`;

  const filename = "document.ldoc";
  const fullPath = join(targetDir, filename);
  
  if (await Bun.file(fullPath).exists()) {
    console.error(`Error: ${filename} already exists in ${targetDir}`);
    process.exit(1);
  }
  
  await Bun.write(fullPath, template);
  console.log(`✓ Created ${fullPath}`);
  console.log(`\nTo compile: ldoc compile ${filename}`);
}

async function decompileCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".docx"));
  if (!inputFile) {
    console.error("Error: No input .docx file specified");
    process.exit(1);
  }

  const outputIndex = args.indexOf("-o") !== -1 ? args.indexOf("-o") : args.indexOf("--output");
  const outputFile =
    outputIndex !== -1 ? (args[outputIndex + 1] ?? "") : inputFile.replace(".docx", ".ldoc");
  if (!outputFile) {
    console.error("Error: Missing output path after -o/--output");
    process.exit(1);
  }

  // Parse emitIndent option
  const options: DecompilerOptions = {};
  if (args.includes("--no-indent")) {
    options.emitIndent = 'off';
  } else if (args.includes("--emit-indent")) {
    options.emitIndent = 'on';
  }

  console.log(`Decompiling ${inputFile} -> ${outputFile}`);

  try {
    const buf = await Bun.file(inputFile).arrayBuffer();
    const result = await docxToLdoc(buf, options);
    
    // Write the LDOC source
    await Bun.write(outputFile, result.source);
    console.log(`✓ Written ${outputFile} (${result.source.length} chars)`);
    
    // Write any extracted assets (images)
    if (result.assets.size > 0) {
      const outputDir = outputFile.replace(/\.ldoc$/, "").replace(/\.[^/.]+$/, "") || ".";
      const { dirname, join } = await import("node:path");
      const { mkdir } = await import("node:fs/promises");
      const baseDir = dirname(outputFile) || ".";
      
      for (const [assetPath, data] of result.assets) {
        const fullPath = join(baseDir, assetPath);
        // Ensure directory exists
        await mkdir(dirname(fullPath), { recursive: true });
        await Bun.write(fullPath, data);
        console.log(`  ✓ Extracted ${assetPath} (${data.length} bytes)`);
      }
    }
  } catch (error) {
    console.error("Decompile error:", error);
    process.exit(1);
  }
}

async function compileCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const outputIndex = args.indexOf("-o") !== -1 ? args.indexOf("-o") : args.indexOf("--output");
  const outputFile =
    outputIndex !== -1 ? (args[outputIndex + 1] ?? "") : inputFile.replace(".ldoc", ".docx");
  if (!outputFile) {
    console.error("Error: Missing output path after -o/--output");
    process.exit(1);
  }

  console.log(`Compiling ${inputFile} -> ${outputFile}`);

  try {
    const input = await Bun.file(inputFile).text();
    const ast = parse(input, { sourcePath: inputFile });
    const buffer = await compile(ast);

    await Bun.write(outputFile, buffer);
    console.log(`✓ Written ${outputFile} (${buffer.length} bytes)`);
  } catch (error) {
    console.error("Compilation error:", error);
    process.exit(1);
  }
}

async function watchCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const outputFile = inputFile.replace(".ldoc", ".docx");

  console.log(`Watching ${inputFile} for changes...`);
  console.log(`Output: ${outputFile}`);
  console.log("Press Ctrl+C to stop\n");

  // Initial compile
  await doCompile(inputFile, outputFile);

  // Watch for changes
  const watcher = Bun.spawn(["fswatch", "-o", inputFile], {
    stdout: "pipe",
  });

  const reader = watcher.stdout.getReader();

  while (true) {
    const { done } = await reader.read();
    if (done) break;

    await doCompile(inputFile, outputFile);
  }
}

async function doCompile(inputFile: string, outputFile: string) {
  const timestamp = new Date().toLocaleTimeString();
  process.stdout.write(`[${timestamp}] Compiling... `);

  try {
    const input = await Bun.file(inputFile).text();
    const ast = parse(input, { sourcePath: inputFile });
    const buffer = await compile(ast);

    await Bun.write(outputFile, buffer);
    console.log(`✓ ${buffer.length} bytes`);
  } catch (error) {
    console.log("✗ Error");
    console.error(error);
  }
}

async function parseCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const asJson = args.includes("--json");

  try {
    const input = await Bun.file(inputFile).text();
    const ast = parse(input, { sourcePath: inputFile });

    if (asJson) {
      console.log(JSON.stringify(ast, null, 2));
    } else {
      console.dir(ast, { depth: null, colors: true });
    }
  } catch (error) {
    console.error("Parse error:", error);
    process.exit(1);
  }
}

async function validateCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  try {
    const input = await Bun.file(inputFile).text();
    parse(input, { sourcePath: inputFile });
    console.log(JSON.stringify({ valid: true }));
    process.exit(0);
  } catch (error) {
    const errObj: { valid: false; error?: string; line?: number; column?: number } = {
      valid: false,
    };

    if (error instanceof Error) {
      errObj.error = error.message;

      // Extract line/column from error message (format: "line N, column M")
      // Note: Do NOT use error.line/error.column directly as those refer to stack trace
      // positions in Bun/V8, not the user's document positions.
      const match = error.message.match(/line\s+(\d+),?\s*column\s+(\d+)/i);
      if (match) {
        errObj.line = parseInt(match[1] ?? "0", 10);
        errObj.column = parseInt(match[2] ?? "0", 10);
      }
    } else {
      errObj.error = String(error);
    }

    console.log(JSON.stringify(errObj));
    process.exit(1);
  }
}

async function fmtCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input .ldoc file specified");
    process.exit(1);
  }

  const writeBack = args.includes("-w") || args.includes("--write");
  const useSpaces = args.includes("--spaces");

  try {
    const input = await Bun.file(inputFile).text();
    const formatted = format(input, { useTabs: !useSpaces });

    if (writeBack) {
      await Bun.write(inputFile, formatted);
      console.log(`✓ Formatted ${inputFile}`);
    } else {
      process.stdout.write(formatted);
    }
  } catch (error) {
    console.error("Format error:", error);
    process.exit(1);
  }
}

async function diffCommand(args: string[]) {
  const ldocFiles = args.filter((a) => a.endsWith(".ldoc"));
  if (ldocFiles.length < 2) {
    console.error("Error: Two .ldoc files required for diff");
    process.exit(1);
  }

  const fileA = ldocFiles[0]!;
  const fileB = ldocFiles[1]!;
  const asJson = args.includes("--json");

  try {
    const textA = await Bun.file(fileA).text();
    const textB = await Bun.file(fileB).text();

    const changes = diffLdoc(textA, textB);

    if (asJson) {
      console.log(JSON.stringify(changes, null, 2));
    } else {
      // Human-readable colored output
      printColoredDiff(changes);
    }
  } catch (error) {
    console.error("Diff error:", error);
    process.exit(1);
  }
}

function printColoredDiff(changes: Change[]): void {
  const RED = "\x1b[31m";
  const GREEN = "\x1b[32m";
  const GREY = "\x1b[90m";
  const RESET = "\x1b[0m";

  for (const change of changes) {
    const lines = change.value;
    if (change.added) {
      process.stdout.write(`${GREEN}${lines}${RESET}`);
    } else if (change.removed) {
      process.stdout.write(`${RED}${lines}${RESET}`);
    } else {
      process.stdout.write(`${GREY}${lines}${RESET}`);
    }
  }
}

main();
