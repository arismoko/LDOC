/**
 * Fidelity check types and interfaces
 */

export interface DocumentInfo {
  id: string;
  file: string;
  description?: string;
  tags?: string[];
  expectedDifferences?: ExpectedDifference[];
  skipChecks?: string[];
}

export interface ExpectedDifference {
  check: string;
  reason: string;
  ticket?: string;
}

export interface Manifest {
  version: number;
  documents: DocumentInfo[];
}

export type Severity = 'critical' | 'major' | 'minor';

export type Verdict =
  | "pass"           // All checks pass
  | "content_diff"   // Round-trip content differs
  | "structural"     // Structure differs (tables, styles)
  | "parse_error"    // Failed to parse LDOC
  | "bind_error"     // Failed to bind (imports, symbols)
  | "eval_error"     // Failed to evaluate
  | "emit_error"     // Failed to emit DOCX
  | "decompile_error"; // Failed to decompile original

export interface StageResult {
  status: "success" | "error" | "skipped";
  duration: number;
  errorCount: number;
  warningCount: number;
}

export interface StageResults {
  decompile: StageResult;
  parse: StageResult;
  bind: StageResult;
  evaluate: StageResult;
  style: StageResult;
  emit: StageResult;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  severity: Severity;
  expected?: unknown;
  actual?: unknown;
  message?: string;
  isExpectedDifference?: boolean;
}

export interface DocumentCommands {
  rerun_single: string;
  rerun_check?: string;
}

export interface DocumentResult {
  id: string;
  file: string;
  passed: boolean;
  verdict?: Verdict;
  checks: CheckResult[];
  duration: number;
  error?: string;
  artifactsDir?: string;
  commands?: DocumentCommands;
  diagnosis?: StageDiagnosis;
  stages?: StageResults;
}

export interface RunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    expectedFails: number;
    duration: number;
    // Verdict breakdown
    verdicts?: {
      pass: number;
      content_diff: number;
      parse_error: number;
      bind_error: number;
      eval_error: number;
      emit_error: number;
      decompile_error: number;
      structural: number;
    };
  };
  documents: DocumentResult[];
  timestamp: string;
  commit?: string;
}

export interface RunOptions {
  checks: ("structural" | "textual" | "visual")[];
  filter?: string[];
  docFilter?: string[];
  checkFilter?: string[];
  generateArtifacts: "all" | "failures" | "none";
  verbose?: boolean;
  quiet?: boolean;
  corpusPath?: string;
}

export interface FidelityCheck {
  name: string;
  category: "structural" | "textual" | "visual";
  run(
    originalDocx: Buffer,
    recompiledDocx: Buffer,
    ldocSource: string,
    options: { artifactsDir: string; verbose?: boolean }
  ): Promise<CheckResult[]>;
}

export interface StructuralMetrics {
  paragraphCount: number;
  emptyParagraphCount: number;
  tableCount: number;
  tableSignatures: string[];
  styleUsage: Record<string, number>;
}

export interface StageDiagnosis {
  likely_stage: "decompiler" | "parser" | "evaluator" | "emitter" | "unknown";
  confidence: "high" | "medium" | "low";
  evidence: string;
  paragraph_counts: {
    original: number;
    cst: number;
    document: number;
    recompiled: number;
  };
  first_divergence?: {
    stage: "decompiler" | "parser" | "evaluator" | "emitter";
    paragraph_index: number;
    detail: string;
  };
}

export interface TextualMetrics {
  charCount: number;
  wordCount: number;
  lineCount: number;
  contentHash: string;
}

export interface VisualMetrics {
  pageCount: number | null;
}
