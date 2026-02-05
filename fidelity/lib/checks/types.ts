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
  checks: CheckResult[];
  duration: number;
  error?: string;
  artifactsDir?: string;
  commands?: DocumentCommands;
  diagnosis?: StageDiagnosis;
}

export interface RunResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
    expectedFails: number;
    duration: number;
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
  likely_stage: 'decompiler' | 'parser' | 'compiler' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  paragraph_counts: {
    original: number;
    ldoc: number;
    ast: number;
    recompiled: number;
  };
  first_divergence?: {
    stage: 'decompiler' | 'parser' | 'compiler';
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
