/**
 * Expression evaluation for conditions and variable access.
 */

import { getPathValue } from "./utils.ts";

/**
 * Determine if a value is truthy in the DSL's condition semantics.
 */
export function truthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0 && v.toLowerCase() !== "false";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Tokenize a condition expression into tokens.
 */
export function tokenizeCond(raw: string): string[] {
  const s = raw.trim();
  const out: string[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s.charAt(i);

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let buf = quote;
      i++;
      while (i < s.length) {
        const c = s.charAt(i);
        if (c === "\\") {
          if (i + 1 >= s.length) break;
          buf += c + s.charAt(i + 1);
          i += 2;
          continue;
        }
        buf += c;
        i++;
        if (c === quote) break;
      }
      out.push(buf);
      continue;
    }

    // Multi-char operators
    if (s.startsWith("==", i)) { out.push("=="); i += 2; continue; }
    if (s.startsWith("!=", i)) { out.push("!="); i += 2; continue; }
    if (s.startsWith("<=", i)) { out.push("<="); i += 2; continue; }
    if (s.startsWith(">=", i)) { out.push(">="); i += 2; continue; }
    if (s.startsWith("&&", i)) { out.push("&&"); i += 2; continue; }
    if (s.startsWith("||", i)) { out.push("||"); i += 2; continue; }

    // Single-char operators/punctuation
    if (["(", ")", "!", "<", ">", "+", "-", "*", "/"].includes(ch)) {
      out.push(ch);
      i++;
      continue;
    }

    // Identifiers / Numbers
    const start = i;
    while (
      i < s.length &&
      !/\s/.test(s.charAt(i)) &&
      !["(", ")", "!", "<", ">", "+", "-", "*", "/", "=", "&", "|"].includes(s.charAt(i))
    ) {
      i++;
    }

    if (i === start) {
      out.push(s.charAt(i));
      i++;
    } else {
      out.push(s.slice(start, i));
    }
  }

  return out;
}

/**
 * Parse a literal value from a token.
 */
export function parseLiteral(token: string): unknown {
  // String literals
  if ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1).replace(/\\(.)/g, "$1");
  }

  // Booleans
  if (token === "true") return true;
  if (token === "false") return false;

  // Null/undefined
  if (token === "null" || token === "undefined") return null;

  // Numbers
  const num = Number(token);
  if (!Number.isNaN(num)) return num;

  // Return as-is (identifier)
  return token;
}

/**
 * Resolve a variable path from context.
 */
export function resolveVariable(
  path: string,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;

  const root = parts[0]!;
  let value: unknown;

  if (root in locals) {
    value = locals[root];
  } else {
    value = getPathValue(globals, [root]);
  }

  if (parts.length === 1) return value;
  return getPathValue(value, parts.slice(1));
}

/**
 * Evaluate a condition expression.
 */
export function evalCondition(
  raw: string,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): unknown {
  const tokens = tokenizeCond(raw);
  if (tokens.length === 0) return false;

  // Simple cases
  if (tokens.length === 1) {
    return resolveOrLiteral(tokens[0]!, locals, globals);
  }

  // Parse expression with precedence
  return parseExpression(tokens, 0, locals, globals).value;
}

function resolveOrLiteral(
  token: string,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): unknown {
  // Check for string/number literals first
  if ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))) {
    return parseLiteral(token);
  }

  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null" || token === "undefined") return null;

  const num = Number(token);
  if (!Number.isNaN(num) && token.match(/^-?\d+(\.\d+)?$/)) {
    return num;
  }

  // Variable lookup
  return resolveVariable(token, locals, globals);
}

interface ParseResult {
  value: unknown;
  index: number;
}

function parseExpression(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  return parseOr(tokens, index, locals, globals);
}

function parseOr(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseAnd(tokens, index, locals, globals);
  
  while (result.index < tokens.length && tokens[result.index] === "||") {
    const right = parseAnd(tokens, result.index + 1, locals, globals);
    result = {
      value: truthy(result.value) || truthy(right.value),
      index: right.index,
    };
  }
  
  return result;
}

function parseAnd(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseEquality(tokens, index, locals, globals);
  
  while (result.index < tokens.length && tokens[result.index] === "&&") {
    const right = parseEquality(tokens, result.index + 1, locals, globals);
    result = {
      value: truthy(result.value) && truthy(right.value),
      index: right.index,
    };
  }
  
  return result;
}

function parseEquality(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseComparison(tokens, index, locals, globals);
  
  while (result.index < tokens.length) {
    const op = tokens[result.index];
    if (op !== "==" && op !== "!=") break;
    
    const right = parseComparison(tokens, result.index + 1, locals, globals);
    const eq = result.value === right.value;
    result = {
      value: op === "==" ? eq : !eq,
      index: right.index,
    };
  }
  
  return result;
}

function parseComparison(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseAdditive(tokens, index, locals, globals);
  
  while (result.index < tokens.length) {
    const op = tokens[result.index];
    if (!["<", ">", "<=", ">="].includes(op!)) break;
    
    const right = parseAdditive(tokens, result.index + 1, locals, globals);
    const l = result.value as number;
    const r = right.value as number;
    
    let cmp: boolean;
    switch (op) {
      case "<": cmp = l < r; break;
      case ">": cmp = l > r; break;
      case "<=": cmp = l <= r; break;
      case ">=": cmp = l >= r; break;
      default: cmp = false;
    }
    
    result = { value: cmp, index: right.index };
  }
  
  return result;
}

function parseAdditive(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseMultiplicative(tokens, index, locals, globals);
  
  while (result.index < tokens.length) {
    const op = tokens[result.index];
    if (op !== "+" && op !== "-") break;
    
    const right = parseMultiplicative(tokens, result.index + 1, locals, globals);
    const l = result.value;
    const r = right.value;
    
    let val: unknown;
    if (op === "+") {
      if (typeof l === "string" || typeof r === "string") {
        val = String(l) + String(r);
      } else {
        val = (l as number) + (r as number);
      }
    } else {
      val = (l as number) - (r as number);
    }
    
    result = { value: val, index: right.index };
  }
  
  return result;
}

function parseMultiplicative(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  let result = parseUnary(tokens, index, locals, globals);
  
  while (result.index < tokens.length) {
    const op = tokens[result.index];
    if (op !== "*" && op !== "/") break;
    
    const right = parseUnary(tokens, result.index + 1, locals, globals);
    const l = result.value as number;
    const r = right.value as number;
    
    result = {
      value: op === "*" ? l * r : l / r,
      index: right.index,
    };
  }
  
  return result;
}

function parseUnary(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  const token = tokens[index];
  
  if (token === "!") {
    const result = parseUnary(tokens, index + 1, locals, globals);
    return { value: !truthy(result.value), index: result.index };
  }
  
  if (token === "-") {
    const result = parseUnary(tokens, index + 1, locals, globals);
    return { value: -(result.value as number), index: result.index };
  }
  
  return parsePrimary(tokens, index, locals, globals);
}

function parsePrimary(
  tokens: string[],
  index: number,
  locals: Record<string, unknown>,
  globals: Record<string, unknown>
): ParseResult {
  const token = tokens[index];
  if (!token) {
    return { value: undefined, index };
  }
  
  // Parentheses
  if (token === "(") {
    const result = parseExpression(tokens, index + 1, locals, globals);
    if (tokens[result.index] === ")") {
      return { value: result.value, index: result.index + 1 };
    }
    return result;
  }
  
  // Literal or variable
  return {
    value: resolveOrLiteral(token, locals, globals),
    index: index + 1,
  };
}
