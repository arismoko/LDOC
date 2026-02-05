/**
 * Main fidelity test runner
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import type { DocumentInfo, DocumentResult, RunOptions, RunResult, CheckResult, StageDiagnosis } from "./checks/types";
import { getAvailableDocuments, loadDocument, getCorpusPath } from "./corpus";
import { runStructuralChecks, extractStructuralMetrics } from "./checks/structural";
import { runTextualChecks } from "./checks/textual";
import { runVisualChecks } from "./checks/visual";
import { diagnoseStage, countLdocParagraphs, countAstParagraphs, type ParagraphCounts } from "./diagnosis";
import { extractTextFromDocx, extractTextFromLdoc, extractTextFromAst } from "./text-extraction";
import { alignParagraphs, formatAlignmentJson } from "./alignment";

// Import from main LDOC source
import { decompile } from "../../src/decompiler";
import { parse } from "../../src/parser";
import { compile } from "../../src/compiler";
import type { DocumentNode } from "../../src/parser/ast";

const FIDELITY_ROOT = resolve(import.meta.dir, "..");
const ARTIFACTS_DIR = join(FIDELITY_ROOT, "artifacts");

export async function runFidelityTests(options: RunOptions): Promise<RunResult> {
  const startTime = Date.now();
  let documents = getAvailableDocuments(options.filter);
  const corpusPath = getCorpusPath();

  // Filter by document ID if specified
  if (options.docFilter && options.docFilter.length > 0) {
    documents = documents.filter((doc) => options.docFilter!.includes(doc.id));
  }

  if (documents.length === 0) {
    console.error("No documents found in corpus");
    console.error(`Corpus path: ${corpusPath}`);
    console.error("Check that LDOC_CORPUS_PATH is set correctly or documents exist in fidelity/corpus/docs/");
    process.exit(1);
  }

  // Prepare artifacts directory
  if (options.generateArtifacts !== "none") {
    rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }

  const results: DocumentResult[] = [];

  for (const doc of documents) {
    if (options.verbose) {
      console.log(`Processing: ${doc.id}...`);
    }

    const docResult = await processDocument(doc, options);
    results.push(docResult);

    // Quick progress indicator
    const status = docResult.passed ? "✓" : docResult.error ? "✗" : "✗";
    if (!options.verbose && !options.quiet) {
      process.stdout.write(status);
    }
  }

  if (!options.verbose && !options.quiet) {
    process.stdout.write("\n");
  }

  const duration = Date.now() - startTime;

  // Calculate summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && !r.error).length;
  const errored = results.filter((r) => r.error).length;

  return {
    summary: {
      total: results.length,
      passed,
      failed: failed + errored,
      expectedFails: 0, // TODO: implement expected differences
      duration,
    },
    documents: results,
    timestamp: new Date().toISOString(),
  };
}

async function processDocument(doc: DocumentInfo, options: RunOptions): Promise<DocumentResult> {
  const startTime = Date.now();
  const artifactsDir = join(ARTIFACTS_DIR, "docs", doc.id);

  try {
    // Load original document
    const originalDocx = loadDocument(doc);

    // Decompile to LDOC
    const decompileResult = await decompile(originalDocx);
    const ldocSource = decompileResult.source;

    // Parse and recompile
    const ast = parse(ldocSource) as DocumentNode;
    const recompiledDocx = await compile(ast);
    const recompiledBuffer = Buffer.from(recompiledDocx);

    // Capture paragraph counts at each stage for diagnosis
    const originalMetrics = await extractStructuralMetrics(originalDocx);
    const recompiledMetrics = await extractStructuralMetrics(recompiledBuffer);
    
    const paragraphCounts: ParagraphCounts = {
      original: originalMetrics.paragraphCount,
      ldoc: countLdocParagraphs(ldocSource),
      ast: countAstParagraphs(ast),
      recompiled: recompiledMetrics.paragraphCount,
    };

    // Save artifacts if needed
    if (options.generateArtifacts === "all") {
      saveArtifacts(artifactsDir, originalDocx, recompiledDocx, ldocSource, ast);
    }

    // Run checks
    const allChecks: CheckResult[] = [];
    const checkOptions = { artifactsDir, verbose: options.verbose };

    if (options.checks.includes("structural")) {
      const structuralResults = await runStructuralChecks(
        originalDocx,
        recompiledBuffer,
        ldocSource,
        checkOptions
      );
      allChecks.push(...structuralResults);
    }

    if (options.checks.includes("textual")) {
      const textualResults = await runTextualChecks(
        originalDocx,
        recompiledBuffer,
        ldocSource,
        checkOptions
      );
      allChecks.push(...textualResults);
    }

    if (options.checks.includes("visual")) {
      const visualResults = await runVisualChecks(
        originalDocx,
        recompiledBuffer,
        ldocSource,
        checkOptions
      );
      allChecks.push(...visualResults);
    }

    // Filter checks by checkFilter if specified
    const filteredChecks = options.checkFilter && options.checkFilter.length > 0
      ? allChecks.filter((c) => options.checkFilter!.includes(c.name))
      : allChecks;

    const passed = filteredChecks.every((c) => c.passed);

    // Run stage diagnosis if there are failures
    let diagnosis: StageDiagnosis | undefined;
    if (!passed) {
      diagnosis = diagnoseStage(paragraphCounts);
    }

    // Save artifacts on failure
    if (!passed && options.generateArtifacts === "failures") {
      saveArtifacts(artifactsDir, originalDocx, recompiledDocx, ldocSource, ast);
    }

    // Generate alignment report for failures
    if (!passed && options.generateArtifacts !== "none") {
      const origText = await extractTextFromDocx(originalDocx);
      const ldocText = extractTextFromLdoc(ldocSource);
      const astText = extractTextFromAst(ast);
      const recompText = await extractTextFromDocx(recompiledBuffer);
      
      const alignment = alignParagraphs(
        origText.paragraphs,
        ldocText.paragraphs,
        astText.paragraphs,
        recompText.paragraphs
      );
      
      writeFileSync(join(artifactsDir, "alignment.json"), formatAlignmentJson(alignment));
    }

    return {
      id: doc.id,
      file: doc.file,
      passed,
      checks: filteredChecks,
      duration: Date.now() - startTime,
      artifactsDir: !passed || options.generateArtifacts === "all" ? artifactsDir : undefined,
      diagnosis,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    
    // Save what we can on error
    if (options.generateArtifacts !== "none") {
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(join(artifactsDir, "error.txt"), message);
    }

    return {
      id: doc.id,
      file: doc.file,
      passed: false,
      checks: [],
      duration: Date.now() - startTime,
      error: message,
      artifactsDir,
    };
  }
}

function saveArtifacts(
  dir: string,
  originalDocx: Buffer,
  recompiledDocx: Uint8Array,
  ldocSource: string,
  ast: unknown
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "original.docx"), originalDocx);
  writeFileSync(join(dir, "recompiled.docx"), recompiledDocx);
  writeFileSync(join(dir, "decompiled.ldoc"), ldocSource);
  writeFileSync(join(dir, "ast.json"), JSON.stringify(ast, null, 2));
}
