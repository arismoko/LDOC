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
  isKnownDirective,
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
      // Table, LayoutDirective, HeaderFooter, Include are specialized
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
    // Unknown directive — produce a warning (Spec §5.4)
    state.diagnostics.push(
      warning(
        UNKNOWN_DIRECTIVE,
        `Unknown directive '@${dir.name}'`,
        dir.loc,
      ),
    );
    // Still validate body if present (recover and continue)
    if (dir.body) {
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
    state.diagnostics.push(
      warning(
        MISPLACED_DIRECTIVE,
        `'@${dir.name}' is not allowed in ${state.context} context`,
        dir.loc,
      ),
    );
  }

  // Check parent directive constraint
  if (contract.parentDirective || contract.parentDirectives) {
    const parent = state.parentStack[state.parentStack.length - 1];
    const allowedParents = contract.parentDirectives ?? [contract.parentDirective!];
    if (!allowedParents.includes(parent ?? "")) {
      state.diagnostics.push(
        warning(
          MISPLACED_DIRECTIVE,
          `'@${dir.name}' must appear inside ${allowedParents.map((name) => `'@${name}'`).join(" or ")}`,
          dir.loc,
        ),
      );
    }
  }

  // Validate body if present
  if (dir.body) {
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
    state.diagnostics.push(
      warning(
        UNKNOWN_DIRECTIVE,
        `Unknown directive '@${dir.name}'`,
        dir.loc,
      ),
    );
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
