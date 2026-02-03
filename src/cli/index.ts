#!/usr/bin/env bun

// CLI for Legal Document DSL

import { Parser } from "../parser/parser";
import { compile } from "../compiler";

const HELP = `
ldoc - Legal Document DSL Compiler

Usage:
  ldoc compile <input.ldoc> [-o output.docx]
  ldoc watch <input.ldoc>
  ldoc parse <input.ldoc> [--json]

Commands:
  compile   Compile .ldoc to .docx
  watch     Watch file and recompile on changes
  parse     Parse and output AST (for debugging)

Options:
  -o, --output    Output file path (default: <input>.docx)
  --json          Output AST as JSON
  -h, --help      Show this help

Examples:
  ldoc compile agreement.ldoc
  ldoc compile agreement.ldoc -o output/agreement.docx
  ldoc watch agreement.ldoc
  ldoc parse agreement.ldoc --json
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];

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

async function compileCommand(args: string[]) {
  const inputFile = args.find((a) => a.endsWith(".ldoc"));
  if (!inputFile) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  const outputIndex = args.indexOf("-o") !== -1 ? args.indexOf("-o") : args.indexOf("--output");
  const outputFile = outputIndex !== -1 ? args[outputIndex + 1] : inputFile.replace(".ldoc", ".docx");

  console.log(`Compiling ${inputFile} -> ${outputFile}`);

  try {
    const input = await Bun.file(inputFile).text();
    const ast = new Parser().parse(input, { sourcePath: inputFile });
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
    const ast = new Parser().parse(input, { sourcePath: inputFile });
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
    const ast = new Parser().parse(input, { sourcePath: inputFile });

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

main();
