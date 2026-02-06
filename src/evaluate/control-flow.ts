/**
 * Control flow handling: @if, @elseif, @else, @foreach, @repeat
 */

import type { CSTNode, CSTDirective } from "../types/cst.ts";
import type { Block } from "../types/document-ir.ts";
import type { Diagnostic } from "../types/diagnostics.ts";
import { DiagnosticCode, error } from "../types/diagnostics.ts";
import { evalCondition, truthy, resolveVariable } from "./expressions.ts";
import { cloneNodes } from "./utils.ts";
import type { EvaluatorContext, TransformFunction } from "./evaluator.ts";

/**
 * Loop variables available in @foreach.
 */
export interface LoopVariables {
  index: number;   // 0-based
  count: number;   // 1-based
  first: boolean;
  last: boolean;
  length: number;
}

/**
 * Process @if directive with optional @elseif/@else chain.
 */
export function processIf(
  directive: CSTDirective,
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  // Get condition from first argument
  const condArg = directive.arguments[0];
  if (!condArg) {
    ctx.diagnostics.push(
      error(DiagnosticCode.CONDITION_ERROR, "@if requires a condition", directive.loc)
    );
    return [];
  }

  const condExpr = extractCondition(condArg);
  const condValue = evalCondition(condExpr, ctx.locals, ctx.globals);

  if (truthy(condValue)) {
    // Execute then branch (the body)
    if (directive.body) {
      return transformNodes(directive.body, ctx, transform);
    }
    return [];
  }

  // Look for @elseif or @else in body
  if (directive.body) {
    for (const node of directive.body) {
      if (node.type === "Directive") {
        if (node.name === "elseif") {
          const elseifCond = extractCondition(node.arguments[0]);
          if (truthy(evalCondition(elseifCond, ctx.locals, ctx.globals))) {
            if (node.body) {
              return transformNodes(node.body, ctx, transform);
            }
            return [];
          }
        } else if (node.name === "else") {
          if (node.body) {
            return transformNodes(node.body, ctx, transform);
          }
          return [];
        }
      }
    }
  }

  return [];
}

/**
 * Process @foreach directive.
 */
export function processForeach(
  directive: CSTDirective,
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  // @foreach(item, collection) or @foreach(item: collection)
  const args = directive.arguments;
  if (args.length < 2) {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, "@foreach requires item and collection", directive.loc)
    );
    return [];
  }

  const itemName = extractIdentifier(args[0]);
  const collectionExpr = extractExpression(args[1]);

  if (!itemName || !collectionExpr) {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, "@foreach: invalid syntax", directive.loc)
    );
    return [];
  }

  // Resolve collection
  const collection = resolveVariable(collectionExpr, ctx.locals, ctx.globals);
  if (collection === undefined || collection === null) {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, `@foreach: collection '${collectionExpr}' not found`, directive.loc)
    );
    return [];
  }

  // Convert to array
  let items: unknown[];
  if (Array.isArray(collection)) {
    items = collection;
  } else if (typeof collection === "string") {
    const s = collection.trim();
    if (!s) {
      items = [];
    } else if (s.includes(",")) {
      items = s.split(",").map((x) => x.trim()).filter(Boolean);
    } else {
      items = [s];
    }
  } else if (typeof collection === "object") {
    items = Object.keys(collection);
  } else {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, `@foreach: invalid collection type`, directive.loc)
    );
    return [];
  }

  // Check limit
  if (items.length > ctx.maxIterations) {
    ctx.diagnostics.push(
      error(
        DiagnosticCode.ITERATION_ERROR,
        `@foreach: collection length (${items.length}) exceeds maximum (${ctx.maxIterations})`,
        directive.loc
      )
    );
    return [];
  }

  const results: Block[] = [];
  const body = directive.body ?? [];

  for (let i = 0; i < items.length; i++) {
    const loop: LoopVariables = {
      index: i,
      count: i + 1,
      first: i === 0,
      last: i === items.length - 1,
      length: items.length,
    };

    // Create child context with loop variables
    const childLocals = {
      ...ctx.locals,
      [itemName]: items[i],
      loop,
    };

    const childCtx: EvaluatorContext = {
      ...ctx,
      locals: childLocals,
      depth: ctx.depth + 1,
    };

    // Clone and transform body
    const clonedBody = cloneNodes(body);
    results.push(...transformNodes(clonedBody, childCtx, transform));
  }

  return results;
}

/**
 * Process @repeat directive.
 */
export function processRepeat(
  directive: CSTDirective,
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  // @repeat(count)
  const countArg = directive.arguments[0];
  if (!countArg) {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, "@repeat requires a count", directive.loc)
    );
    return [];
  }

  const countExpr = extractExpression(countArg);
  const countValue = evalCondition(countExpr, ctx.locals, ctx.globals);
  const count = Number(countValue);

  if (!Number.isFinite(count) || count < 0 || Math.floor(count) !== count) {
    ctx.diagnostics.push(
      error(DiagnosticCode.ITERATION_ERROR, `@repeat: invalid count '${countExpr}'`, directive.loc)
    );
    return [];
  }

  if (count > ctx.maxIterations) {
    ctx.diagnostics.push(
      error(
        DiagnosticCode.ITERATION_ERROR,
        `@repeat: count (${count}) exceeds maximum (${ctx.maxIterations})`,
        directive.loc
      )
    );
    return [];
  }

  const results: Block[] = [];
  const body = directive.body ?? [];

  for (let i = 0; i < count; i++) {
    const loop: LoopVariables = {
      index: i,
      count: i + 1,
      first: i === 0,
      last: i === count - 1,
      length: count,
    };

    const childLocals = {
      ...ctx.locals,
      loop,
    };

    const childCtx: EvaluatorContext = {
      ...ctx,
      locals: childLocals,
      depth: ctx.depth + 1,
    };

    const clonedBody = cloneNodes(body);
    results.push(...transformNodes(clonedBody, childCtx, transform));
  }

  return results;
}

// Helper to extract condition string from argument
function extractCondition(arg: unknown): string {
  if (!arg || typeof arg !== "object") return "";
  const a = arg as Record<string, unknown>;
  
  if (a.type === "PositionalArg" || a.type === "NamedArg") {
    const value = a.value as Record<string, unknown> | undefined;
    if (value?.type === "Expression") return String(value.raw ?? "");
    if (value?.type === "Identifier") return String(value.name ?? "");
    if (value?.type === "StringLiteral") return String(value.value ?? "");
    if (value?.type === "NumberLiteral") return String(value.value ?? "");
    if (value?.type === "BooleanLiteral") return String(value.value ?? "");
  }
  
  return "";
}

// Helper to extract identifier from argument
function extractIdentifier(arg: unknown): string | undefined {
  if (!arg || typeof arg !== "object") return undefined;
  const a = arg as Record<string, unknown>;
  
  if (a.type === "PositionalArg") {
    const value = a.value as Record<string, unknown> | undefined;
    if (value?.type === "Identifier") return String(value.name ?? "");
  }
  
  if (a.type === "NamedArg") {
    return String(a.name ?? "");
  }
  
  return undefined;
}

// Helper to extract expression from argument
function extractExpression(arg: unknown): string {
  if (!arg || typeof arg !== "object") return "";
  const a = arg as Record<string, unknown>;
  
  if (a.type === "PositionalArg" || a.type === "NamedArg") {
    const value = a.value as Record<string, unknown> | undefined;
    if (value?.type === "Expression") return String(value.raw ?? "");
    if (value?.type === "Identifier") return String(value.name ?? "");
    if (value?.type === "StringLiteral") return String(value.value ?? "");
  }
  
  return "";
}

// Helper to transform nodes using the provided transform function
function transformNodes(
  nodes: CSTNode[],
  ctx: EvaluatorContext,
  transform: TransformFunction
): Block[] {
  const results: Block[] = [];
  for (const node of nodes) {
    results.push(...transform(node, ctx));
  }
  return results;
}
