/**
 * Validator for the BIND phase (v3).
 *
 * Walks the v3 CST and validates:
 * - Unknown directives produce warnings (Spec §5.4)
 * - Directive context constraints (e.g. @document only at top, @row only in @table)
 */

import type {
  Document,
  Block,
  Directive,
  StructuralBody,
  ListItemMarker,
  Inline,
  InlineDirective,
  ParagraphBlock,
} from "../types/cst.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { warning, DiagnosticCode } from "../types/diagnostics.ts";
import {
  getDirectiveContract,
  knownDirectiveNames,
  type DirectiveContext,
} from "./contracts.ts";

// =============================================================================
// Diagnostic codes for validation
// =============================================================================

const UNKNOWN_DIRECTIVE = "B020";
const MISPLACED_DIRECTIVE = "B021";

// =============================================================================
// Validation Context
// =============================================================================

interface ValidationState {
  diagnostics: Diagnostic[];
  /** Stack of parent directive names for context checking */
  parentStack: string[];
  /** Current context: "top" for document root, "structural" for inside a body */
  context: DirectiveContext;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate a v3 CST document.
 * Returns diagnostics for unknown or misplaced directives.
 */
export function validate(cst: Document): Diagnostic[] {
  const state: ValidationState = {
    diagnostics: [],
    parentStack: [],
    context: "top",
  };

  validateBlocks(cst.children, state);
  return state.diagnostics;
}

// =============================================================================
// Internal
// =============================================================================

function validateBlocks(blocks: Block[], state: ValidationState): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "Directive":
        validateDirective(block, state);
        break;
      case "ListItemMarker":
        validateListItem(block, state);
        break;
      case "ParagraphBlock":
        validateParagraphInlines(block.inlines, state);
        break;
      case "StructuralBody":
        validateBlocks(block.children, state);
        break;
      // Table, LayoutDirective, HeaderFooter are specialized
      // CST nodes — they were already validated by the parser.
      // We don't need to check their directive names.
      default:
        break;
    }
  }
}

function validateDirective(dir: Directive, state: ValidationState): void {
  const contract = getDirectiveContract(dir.name);

  if (!contract) {
    state.diagnostics.push(unknownDirectiveDiagnostic(dir.name, dir.loc));
    // Still validate body if present (recover and continue)
    if (dir.body && dir.body.kind === "StructuralBody") {
      const childState: ValidationState = {
        ...state,
        context: "structural",
        parentStack: [...state.parentStack, dir.name],
      };
      validateBlocks(dir.body.children, childState);
    }
    return;
  }

  // Check context constraints
  if (!contract.allowedIn.includes(state.context)) {
    state.diagnostics.push(misplacedDirectiveDiagnostic(dir.name, state.context, dir.loc));
  }

  // Check parent directive constraint
  if (contract.parentDirective || contract.parentDirectives) {
    const parent = state.parentStack[state.parentStack.length - 1];
    const allowedParents = contract.parentDirectives ?? [contract.parentDirective!];
    if (!allowedParents.includes(parent ?? "")) {
      state.diagnostics.push(
        misplacedParentDiagnostic(dir.name, allowedParents, dir.loc),
      );
    }
  }

  // Validate body if present
  if (dir.body && dir.body.kind === "StructuralBody") {
    const childState: ValidationState = {
      ...state,
      context: "structural",
      parentStack: [...state.parentStack, dir.name],
    };
    validateBlocks(dir.body.children, childState);
  }
}

function validateListItem(item: ListItemMarker, state: ValidationState): void {
  if (item.body) {
    const childState: ValidationState = {
      ...state,
      context: "structural",
      parentStack: [...state.parentStack, item.ordered ? "@#" : "@-"],
    };
    validateBlocks(item.body.children, childState);
  }
}

function validateParagraphInlines(inlines: Inline[], state: ValidationState): void {
  for (const inline of inlines) {
    if (inline.kind === "InlineDirective") {
      validateInlineDirective(inline, state);
    }
  }
}

function validateInlineDirective(dir: InlineDirective, state: ValidationState): void {
  const contract = getDirectiveContract(dir.name);

  if (!contract) {
    state.diagnostics.push(unknownDirectiveDiagnostic(dir.name, dir.loc));
    // Still validate body inlines
    if (dir.body) {
      validateParagraphInlines(dir.body, state);
    }
    return;
  }

  // Check if directive is allowed inline
  if (!contract.allowedIn.includes("inline")) {
    state.diagnostics.push(
      warning(
        MISPLACED_DIRECTIVE,
        `'@${dir.name}' is not allowed inline`,
        dir.loc,
      ),
    );
  }

  // Validate body inlines
  if (dir.body) {
    validateParagraphInlines(dir.body, state);
  }
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[rows - 1]![cols - 1]!;
}

function suggestDirectiveName(input: string): string | null {
  const candidates = knownDirectiveNames()
    .map((name) => ({ name, distance: levenshtein(input, name) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name));

  const best = candidates[0];
  if (!best || best.distance > 2) {
    return null;
  }
  return best.name;
}

function unknownDirectiveDiagnostic(name: string, location: Directive["loc"]): Diagnostic {
  const suggestion = suggestDirectiveName(name);
  const message = suggestion
    ? `Unknown directive '@${name}'. Did you mean '@${suggestion}'?`
    : `Unknown directive '@${name}'`;
  const diag = warning(UNKNOWN_DIRECTIVE, message, location);

  if (suggestion) {
    diag.suggestions = [{ message: `Replace with @${suggestion}`, replacement: `@${suggestion}` }];
  }

  return diag;
}

function misplacedDirectiveDiagnostic(
  name: string,
  context: DirectiveContext,
  location: Directive["loc"],
): Diagnostic {
  const diag = warning(
    MISPLACED_DIRECTIVE,
    `'@${name}' is not allowed in ${context} context`,
    location,
  );

  if (name === "left" || name === "center" || name === "right") {
    diag.message = `'@${name}' is a header/footer region and must be inside '@header' or '@footer'`;
    diag.suggestions = [{
      message: `Wrap '@${name}' inside @header{...} or @footer{...}`,
      replacement: `@header{\n  @${name}[]\n}`,
    }];
  }

  return diag;
}

function misplacedParentDiagnostic(
  name: string,
  allowedParents: string[],
  location: Directive["loc"],
): Diagnostic {
  const parentList = allowedParents.map((value) => `@${value}`).join(" or ");
  const diag = warning(
    MISPLACED_DIRECTIVE,
    `'@${name}' must appear inside ${parentList}`,
    location,
  );

  if (name === "left" || name === "center" || name === "right") {
    diag.suggestions = [{
      message: `Move '@${name}' into @header{...} or @footer{...}`,
      replacement: `@header{\n  @${name}[]\n}`,
    }];
  }

  return diag;
}
