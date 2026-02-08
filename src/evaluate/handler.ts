/**
 * Handler interfaces for the modular evaluator.
 *
 * EvalContext is the narrow contract handlers use to interact with
 * evaluation state and recursion. EvaluationState remains private
 * inside evaluator.ts — handlers never import the orchestrator.
 */

import type * as CST from "../types/cst.ts";
import type { SymbolTable } from "../types/symbols.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import type {
  Block,
  DocumentMetadata,
  EvaluateResult,
  Inline,
} from "../types/document-ir.ts";
import type { SourceLocation } from "../types/source-location.ts";
import type { LuaEngine } from "wasmoon";

export type SourceLoader = (path: string) => Promise<string>;

export interface EvaluateOptions {
  variables?: Record<string, unknown>;
  sourcePath?: string;
  includeRoot?: string;
  loadFile?: SourceLoader;
  includeStack?: string[];
}

export type EvaluateSubdocument = (
  cst: CST.Document,
  symbols: SymbolTable,
  options: EvaluateOptions,
) => Promise<EvaluateResult>;

export interface EvalContext {
  // Mutable shared state
  diagnostics: Diagnostic[];
  metadata: DocumentMetadata;
  defs: Record<string, unknown>;

  // Read-mostly state
  styles: Record<string, unknown>;
  luaEngine: LuaEngine;
  variables: Record<string, unknown>;
  sourcePath?: string;
  includeRoot?: string;
  loadFile?: SourceLoader;
  includeStack: string[];

  // Recursive evaluation hooks
  evaluateBlock(node: CST.Block): Promise<Block[]>;
  evaluateBlocks(nodes: CST.Block[]): Promise<Block[]>;
  evaluateInline(node: CST.Inline): Promise<Inline[]>;
  evaluateInlines(nodes: CST.Inline[]): Promise<Inline[]>;

  // Re-entry point for @include (breaks circular dependency)
  evaluateSubdocument: EvaluateSubdocument;

  // Footnote support
  allocateFootnoteLabel(): string;
  queueFootnote(content: Block[], loc?: SourceLocation): string;
}

export type BlockDirectiveHandler = (
  node: CST.Directive,
  ctx: EvalContext,
) => Promise<Block[]>;

export type InlineDirectiveHandler = (
  node: CST.InlineDirective,
  bodyInlines: Inline[],
  ctx: EvalContext,
) => Promise<Inline[]>;
