/**
 * Main fidelity test runner
 */

import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import type { DocumentInfo, DocumentResult, RunOptions, RunResult, CheckResult, StageDiagnosis, Verdict, StageResult, StageResults } from "./checks/types";
import { getAvailableDocuments, loadDocument, getCorpusPath } from "./corpus";
import { runStructuralChecks, extractStructuralMetrics } from "./checks/structural";
import { runTextualChecks } from "./checks/textual";
import { runVisualChecks } from "./checks/visual";
import { diagnoseStage, countCstParagraphs, countDocumentParagraphs, type ParagraphCounts } from "./diagnosis";
import { extractTextFromDocx, extractTextFromCst, extractTextFromDocument } from "./text-extraction";
import { alignParagraphs, formatAlignmentJson } from "./alignment";

// Import from main LDOC source
import { decompile } from "../../src/decompiler";
import { parseSource } from "../../src/parse";
import { bind } from "../../src/bind";
import { evaluate } from "../../src/evaluate";
import { style } from "../../src/style";
import { emit } from "../../src/emit";
import type { SymbolTable } from "../../src/types/symbols";
import type { EvaluateResult } from "../../src/types/document-ir";
import type { EmitResult } from "../../src/emit";
import type { Diagnostic } from "../../src/types/diagnostics";

const FIDELITY_ROOT = resolve(import.meta.dir, "..");
const ARTIFACTS_DIR = join(FIDELITY_ROOT, "artifacts");

function createStageResult(status: StageResult["status"], duration: number, errorCount = 0, warningCount = 0): StageResult {
  return { status, duration, errorCount, warningCount };
}

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
  
  const stages: Partial<StageResults> = {};
  let verdict: Verdict = "pass";

  // Helper to save diagnostics
  const allDiagnostics: Record<string, unknown[]> = {};

  try {
    // Stage 1: Load original document
    const originalDocx = loadDocument(doc);

    // Stage 2: Decompile
    let ldocSource: string;
    const decompileStart = Date.now();
    try {
      const decompileResult = await decompile(originalDocx);
      ldocSource = decompileResult.source;
      stages.decompile = createStageResult("success", Date.now() - decompileStart);
    } catch (e) {
      stages.decompile = createStageResult("error", Date.now() - decompileStart, 1);
      verdict = "decompile_error";
      throw e;
    }

    // Stage 3: Parse
    const parseStart = Date.now();
    const parseResult = parseSource(ldocSource);
    const parseErrors = parseResult.diagnostics.filter(d => d.severity === "error");
    const parseWarnings = parseResult.diagnostics.filter(d => d.severity === "warning");
    stages.parse = createStageResult(
      parseErrors.length > 0 ? "error" : "success",
      Date.now() - parseStart,
      parseErrors.length,
      parseWarnings.length
    );
    allDiagnostics.parse = parseResult.diagnostics;
    
    if (parseErrors.length > 0) {
      verdict = "parse_error";
      // Save what we have and fail fast
      if (options.generateArtifacts !== "none") {
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(join(artifactsDir, "decompiled.ldoc"), ldocSource);
        writeFileSync(join(artifactsDir, "diagnostics.json"), JSON.stringify(allDiagnostics, null, 2));
      }
      return {
        id: doc.id,
        file: doc.file,
        passed: false,
        verdict,
        stages: stages as StageResults,
        checks: [],
        duration: Date.now() - startTime,
        error: `Parse error: ${parseErrors[0]?.message ?? "unknown"}`,
        artifactsDir,
      };
    }

    // Stage 4: Bind
    const bindStart = Date.now();
    const bindResult = await bind(parseResult.cst, {
      sourcePath: doc.file,
      loadFile: async (path: string) => {
        const content = await Bun.file(path).text();
        return parseSource(content);
      },
    });
    const bindErrors = bindResult.diagnostics.filter(d => d.severity === "error");
    const bindWarnings = bindResult.diagnostics.filter(d => d.severity === "warning");
    stages.bind = createStageResult(
      bindErrors.length > 0 ? "error" : "success",
      Date.now() - bindStart,
      bindErrors.length,
      bindWarnings.length
    );
    allDiagnostics.bind = bindResult.diagnostics;
    
    if (bindErrors.length > 0) {
      verdict = "bind_error";
      if (options.generateArtifacts !== "none") {
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(join(artifactsDir, "decompiled.ldoc"), ldocSource);
        writeFileSync(join(artifactsDir, "cst.json"), JSON.stringify(parseResult.cst, null, 2));
        writeFileSync(join(artifactsDir, "diagnostics.json"), JSON.stringify(allDiagnostics, null, 2));
      }
      return {
        id: doc.id,
        file: doc.file,
        passed: false,
        verdict,
        stages: stages as StageResults,
        checks: [],
        duration: Date.now() - startTime,
        error: `Bind error: ${bindErrors[0]?.message ?? "unknown"}`,
        artifactsDir,
      };
    }

    // Stage 5: Evaluate
    const evalStart = Date.now();
    let evalResult: EvaluateResult;
    try {
      evalResult = evaluate(parseResult.cst, bindResult.symbols);
      const evalErrors = evalResult.diagnostics.filter((d: Diagnostic) => d.severity === "error");
      const evalWarnings = evalResult.diagnostics.filter((d: Diagnostic) => d.severity === "warning");
      stages.evaluate = createStageResult(
        evalErrors.length > 0 ? "error" : "success",
        Date.now() - evalStart,
        evalErrors.length,
        evalWarnings.length
      );
      allDiagnostics.evaluate = evalResult.diagnostics;
      
      if (evalErrors.length > 0) {
        verdict = "eval_error";
        throw new Error(`Evaluate error: ${evalErrors[0]?.message ?? "unknown"}`);
      }
    } catch (e) {
      if (!stages.evaluate) {
        stages.evaluate = createStageResult("error", Date.now() - evalStart, 1);
      }
      verdict = "eval_error";
      throw e;
    }

    // Stage 6: Style
    const styleStart = Date.now();
    const styleResult = style(evalResult.document, bindResult.symbols);
    stages.style = createStageResult("success", Date.now() - styleStart);

    // Stage 7: Emit
    const emitStart = Date.now();
    let emitResult: EmitResult;
    try {
      emitResult = await emit(styleResult.styledDocument);
      stages.emit = createStageResult("success", Date.now() - emitStart);
    } catch (e) {
      stages.emit = createStageResult("error", Date.now() - emitStart, 1);
      verdict = "emit_error";
      throw e;
    }
    
    const recompiledDocx = emitResult.buffer;
    const recompiledBuffer = Buffer.from(emitResult.buffer);

    // Decompile the recompiled DOCX for round-trip comparison
    const recompiledLdocResult = await decompile(recompiledBuffer);
    const recompiledLdoc = recompiledLdocResult.source;

    // Capture paragraph counts at each stage for diagnosis
    const originalMetrics = await extractStructuralMetrics(originalDocx);
    const recompiledMetrics = await extractStructuralMetrics(recompiledBuffer);
    
    const paragraphCounts: ParagraphCounts = {
      original: originalMetrics.paragraphCount,
      cst: countCstParagraphs(parseResult.cst),
      document: countDocumentParagraphs(evalResult.document),
      recompiled: recompiledMetrics.paragraphCount,
    };

    // Save artifacts if needed
    if (options.generateArtifacts === "all") {
      saveArtifacts(
        artifactsDir,
        originalDocx,
        recompiledDocx,
        ldocSource,
        recompiledLdoc,
        parseResult.cst,
        evalResult.document,
        styleResult.styledDocument,
        bindResult.symbols,
        allDiagnostics
      );
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
    
    // Determine verdict based on check results
    if (!passed) {
      // Check if it's structural or content diff
      const hasStructuralFail = filteredChecks.some(c => !c.passed && 
        (c.name.includes("paragraph") || c.name.includes("table") || c.name.includes("style")));
      verdict = hasStructuralFail ? "structural" : "content_diff";
    }

    // Run stage diagnosis if there are failures
    let diagnosis: StageDiagnosis | undefined;
    if (!passed) {
      diagnosis = diagnoseStage(paragraphCounts);
    }

    // Save artifacts on failure
    if (!passed && options.generateArtifacts === "failures") {
      saveArtifacts(
        artifactsDir,
        originalDocx,
        recompiledDocx,
        ldocSource,
        recompiledLdoc,
        parseResult.cst,
        evalResult.document,
        styleResult.styledDocument,
        bindResult.symbols,
        allDiagnostics
      );
    }

    // Generate alignment report for failures
    if (!passed && options.generateArtifacts !== "none") {
      const origText = await extractTextFromDocx(originalDocx);
      const cstText = extractTextFromCst(parseResult.cst);
      const docText = extractTextFromDocument(evalResult.document);
      const recompText = await extractTextFromDocx(recompiledBuffer);

      const alignment = alignParagraphs(
        origText.paragraphs,
        cstText.paragraphs,
        docText.paragraphs,
        recompText.paragraphs
      );
      
      writeFileSync(join(artifactsDir, "alignment.json"), formatAlignmentJson(alignment));
    }

    return {
      id: doc.id,
      file: doc.file,
      passed,
      verdict,
      stages: stages as StageResults,
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
      verdict,
      stages: stages as StageResults,
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
  recompiledLdoc: string,
  cst: unknown,
  document: unknown,
  styledDocument: unknown,
  symbols: SymbolTable,
  diagnostics: Record<string, unknown[]>
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "original.docx"), originalDocx);
  writeFileSync(join(dir, "recompiled.docx"), recompiledDocx);
  writeFileSync(join(dir, "decompiled.ldoc"), ldocSource);
  writeFileSync(join(dir, "recompiled.ldoc"), recompiledLdoc);
  writeFileSync(join(dir, "cst.json"), JSON.stringify(cst, null, 2));
  writeFileSync(join(dir, "document.json"), JSON.stringify(document, null, 2));
  writeFileSync(join(dir, "styled.json"), JSON.stringify(styledDocument, null, 2));
  writeFileSync(join(dir, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));

  // Save symbol table summary
  const symbolsSummary = {
    macros: Array.from(symbols.macros.keys()),
    styles: Array.from(symbols.styles.keys()),
    variables: Object.fromEntries(
      Array.from(symbols.variables.entries()).map(([k, v]) => [k, v.value])
    ),
    anchors: Array.from(symbols.anchors.keys()),
    footnotes: Array.from(symbols.footnotes.keys()),
  };
  writeFileSync(join(dir, "symbols.json"), JSON.stringify(symbolsSummary, null, 2));
}
