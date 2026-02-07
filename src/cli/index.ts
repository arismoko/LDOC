#!/usr/bin/env bun

/**
 * LDOC CLI - Legal Document DSL Compiler
 */

import { compile, parseAndBindWithIncludes } from "../pipeline/index.ts";

const HELP = `
ldoc - Legal Document DSL Compiler

Usage:
  ldoc compile <input.ldoc> [-o output.docx]
  ldoc parse <input.ldoc> [--json]
  ldoc validate <input.ldoc>
  ldoc init [dir]

Commands:
  compile   Compile .ldoc to .docx
  parse     Parse and output CST (for debugging)
  validate  Validate .ldoc syntax (outputs JSON)
  init      Initialize a new LDOC project

Options:
  -o, --output      Output file path
  --json            Output as JSON (parse command)
  -h, --help        Show this help

Examples:
  ldoc compile agreement.ldoc
  ldoc compile agreement.ldoc -o output/agreement.docx
  ldoc parse agreement.ldoc --json
  ldoc validate agreement.ldoc
`;

async function main(): Promise<void> {
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

    case "parse":
      await parseCommand(args.slice(1));
      break;

    case "validate":
      await validateCommand(args.slice(1));
      break;

    case "init":
      await initCommand(args.slice(1));
      break;

     default:
       // Assume it's a file to compile
       if (command.endsWith(".ldoc")) {
         await compileCommand(args);
       } else {
         console.error(`Unknown command: ${command}`);
         console.log(HELP);
         process.exit(1);
       }
  }
}

async function initCommand(args: string[]): Promise<void> {
  const targetDir = args[0] || ".";
  const { join } = await import("node:path");

  const template = `@document(
  title: "Untitled Document",
  author: "Author Name",
)

@style(p: { use: "Heading1" })[Introduction]

[This is a new LDOC v3 document.]

@#[First numbered item.]
@#[Second numbered item.]
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

async function compileCommand(args: string[]): Promise<void> {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const outputIndex =
    args.indexOf("-o") !== -1 ? args.indexOf("-o") : args.indexOf("--output");
  const outputFile =
    outputIndex !== -1
      ? (args[outputIndex + 1] ?? "")
      : inputFile.replace(".ldoc", ".docx");
  if (!outputFile) {
    console.error("Error: Missing output path after -o/--output");
    process.exit(1);
  }

  console.log(`Compiling ${inputFile} -> ${outputFile}`);

  try {
    const input = await Bun.file(inputFile).text();
    const result = await compile(input, { sourcePath: inputFile });

    // Log any warnings
    for (const diag of result.diagnostics) {
      if (diag.severity === "warning") {
        console.warn(`Warning: ${diag.message}`);
      }
    }

    await Bun.write(outputFile, result.buffer);
    console.log(`✓ Written ${outputFile} (${result.buffer.length} bytes)`);
  } catch (error) {
    console.error("Compilation error:", error);
    process.exit(1);
  }
}

async function parseCommand(args: string[]): Promise<void> {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const asJson = args.includes("--json");

  try {
    const input = await Bun.file(inputFile).text();
    const { cst, diagnostics } = await parseAndBindWithIncludes(input, {
      sourcePath: inputFile,
    });

    // Show any errors
    for (const diag of diagnostics) {
      if (diag.severity === "error") {
        console.error(`Error: ${diag.message}`);
      }
    }

    if (asJson) {
      console.log(JSON.stringify(cst, null, 2));
    } else {
      console.dir(cst, { depth: null, colors: true });
    }
  } catch (error) {
    console.error("Parse error:", error);
    process.exit(1);
  }
}

async function validateCommand(args: string[]): Promise<void> {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  try {
    const input = await Bun.file(inputFile).text();
    const { diagnostics } = await parseAndBindWithIncludes(input, {
      sourcePath: inputFile,
    });

    const errors = diagnostics.filter((d) => d.severity === "error");
    const warnings = diagnostics.filter((d) => d.severity === "warning");

    if (errors.length === 0) {
      console.log(
        JSON.stringify({ valid: true, warnings: warnings.length })
      );
      process.exit(0);
    } else {
      const firstError = errors[0]!;
      const errObj: { valid: false; error: string; line?: number; column?: number } = {
        valid: false,
        error: firstError.message,
      };

      if (firstError.location) {
        errObj.line = firstError.location.line;
        errObj.column = firstError.location.column;
      }

      console.log(JSON.stringify(errObj));
      process.exit(1);
    }
  } catch (error) {
    const errObj: { valid: false; error?: string; line?: number; column?: number } = {
      valid: false,
    };

    if (error instanceof Error) {
      errObj.error = error.message;

      // Extract line/column from error message
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

main();
