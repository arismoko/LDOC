#!/usr/bin/env bun

/**
 * LDOC v3 Smoke Tests
 * 
 * Run compilation of fixture files to verify the pipeline works.
 * Outputs to /tmp/ldoc-smoke-<timestamp>/ for inspection.
 */

import { compile, parseAndBind } from "../pipeline/index.ts";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  output?: string;
}

async function runSmokeTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const fixturesDir = join(process.cwd(), "fixtures");
  const outputDir = join(process.cwd(), "/tmp", "ldoc-smoke-" + Date.now());
  
  await mkdir(outputDir, { recursive: true });

  const fixtureFiles = ["minimal.ldoc", "lists.ldoc", "table.ldoc"];

  for (const filename of fixtureFiles) {
    const inputPath = join(fixturesDir, filename);
    const outputPath = join(outputDir, filename.replace(".ldoc", ".docx"));
    
    try {
      console.log(`\nTesting: ${filename}`);
      
      const input = await Bun.file(inputPath).text();
      
      // Parse and bind to check syntax
      const { cst, symbols, diagnostics } = parseAndBind(input);
      
      const errors = diagnostics.filter(d => d.severity === "error");
      const warnings = diagnostics.filter(d => d.severity === "warning");
      
      if (symbols.defs.size > 0) {
        console.log(`  📦 Defs: ${symbols.defs.size}`);
        for (const [name, def] of symbols.defs) {
          console.log(`    ${name}: ${JSON.stringify(def.value)}`);
        }
      }
      
      if (warnings.length > 0) {
        console.log(`  ⚠ Warnings: ${warnings.length}`);
        for (const w of warnings) {
          console.log(`    ${w.code}: ${w.message}`);
        }
      }
      
      if (errors.length > 0) {
        console.error(`  ❌ Parse errors: ${errors.length}`);
        results.push({
          name: filename,
          passed: false,
          error: errors.map(e => `${e.location?.line}:${e.location?.column}: ${e.message}`).join("\n"),
        });
        continue;
      }
      
      // Compile to DOCX
      const result = await compile(input, { sourcePath: inputPath });
      
      if (result.diagnostics.some(d => d.severity === "error")) {
        console.error(`  ❌ Compilation errors`);
        results.push({
          name: filename,
          passed: false,
          error: result.diagnostics
            .filter(d => d.severity === "error")
            .map(e => `${e.location?.line}:${e.location?.column}: ${e.message}`)
            .join("\n"),
        });
        continue;
      }
      
      // Write output
      await Bun.write(outputPath, result.buffer);
      
      console.log(`  ✓ Passed`);
      console.log(`    Output: ${outputPath}`);
      console.log(`    Size: ${result.buffer.length} bytes`);
      
      results.push({
        name: filename,
        passed: true,
        output: outputPath,
      });
    } catch (error) {
      console.error(`  ❌ Error:`, error instanceof Error ? error.message : String(error));
      results.push({
        name: filename,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n=== Smoke Test Summary ===`);
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Output directory: ${outputDir}`);

  return results;
}

async function main(): Promise<void> {
  console.log("Running LDOC v3 smoke tests...\n");
  
  await runSmokeTests();
  
  console.log("\nDone!");
  process.exit(0);
}

main();
