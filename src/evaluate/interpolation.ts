/**
 * Interpolation - resolves {{variable | filter}} in text.
 */

import { applyFilters, isTextFilter, type TextFilter } from "../shared/filters.ts";
import { resolveVariable } from "./expressions.ts";

/**
 * Parse a variable expression like "name" or "person.name | upper | capitalize"
 */
interface ParsedExpression {
  path: string;
  filters: TextFilter[];
}

function parseVariableExpression(expr: string): ParsedExpression {
  const parts = expr.split("|").map((p) => p.trim());
  const path = parts[0] ?? "";
  const filters: TextFilter[] = [];
  
  for (let i = 1; i < parts.length; i++) {
    const filterName = parts[i]!;
    if (isTextFilter(filterName)) {
      filters.push(filterName);
    }
  }
  
  return { path, filters };
}

/**
 * Resolve a variable expression and apply filters.
 */
export function resolveInterpolation(
  expression: string,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): string {
  const { path, filters } = parseVariableExpression(expression);
  const value = resolveVariable(path, locals, globals);
  
  if (value === undefined || value === null) {
    return "";
  }
  
  const str = String(value);
  return filters.length > 0 ? applyFilters(str, filters) : str;
}

/**
 * Process a string that may contain {{...}} interpolations.
 */
export function interpolateString(
  text: string,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    return resolveInterpolation(expr.trim(), locals, globals);
  });
}
