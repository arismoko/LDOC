import { TokenType } from "../lexer";
import type { Node } from "../ast";
import { type ParserContext, parseRestOfLineRaw } from "./inline";
import { parseIndentedBlock } from "./helpers";

export function parseIf(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const condition = parseRestOfLineRaw(ctx);
  if (!condition) {
    throw new Error(`@if requires a condition at line ${token.line}, column ${token.column}`);
  }

  // Parse @if block
  const { content: thenBranch, hasEnd: ifHasEnd } = parseIndentedBlock(ctx, { required: true, directiveName: "@if" });

  // If @end was consumed, we're done
  if (ifHasEnd) {
    return {
      type: "if",
      line: token.line,
      column: token.column,
      condition,
      thenBranch,
      elseBranch: [],
      hasEnd: true,
    } as any;
  }

  ctx.stream.skipNewlines();
  const rootElseBranch: Node[] = [];
  let currentElseBranch = rootElseBranch;
  let hasEnd = false;

  // Parse @elseif blocks (transform to nested @if)
  while (ctx.stream.check(TokenType.ELSEIF)) {
    const elseifToken = ctx.stream.advance();
    const elseifCond = parseRestOfLineRaw(ctx);
    if (!elseifCond) {
      throw new Error(`@elseif requires a condition at line ${elseifToken.line}, column ${elseifToken.column}`);
    }

    const { content: elseifThen, hasEnd: elseifHasEnd } = parseIndentedBlock(ctx, { required: true, directiveName: "@elseif" });

    const nestedIf: any = {
      type: "if",
      line: elseifToken.line,
      column: elseifToken.column,
      condition: elseifCond,
      thenBranch: elseifThen,
      elseBranch: [],
    };

    currentElseBranch.push(nestedIf);
    currentElseBranch = nestedIf.elseBranch;

    if (elseifHasEnd) {
      hasEnd = true;
      break;
    }
    ctx.stream.skipNewlines();
  }

  // Parse @else block (only if we haven't hit @end)
  if (!hasEnd && ctx.stream.check(TokenType.ELSE)) {
    ctx.stream.advance();
    const { content: elseBranchContent, hasEnd: elseHasEnd } = parseIndentedBlock(ctx, { required: true, directiveName: "@else" });
    currentElseBranch.push(...elseBranchContent);
    hasEnd = elseHasEnd;
  }

  return {
    type: "if",
    line: token.line,
    column: token.column,
    condition,
    thenBranch,
    elseBranch: rootElseBranch,
    hasEnd,
  } as any;
}

export function parseRepeat(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const raw = parseRestOfLineRaw(ctx);
  if (!raw) {
    throw new Error(`@repeat requires a count at line ${token.line}, column ${token.column}`);
  }

  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim() || n < 0) {
    throw new Error(`@repeat count must be a non-negative integer (line ${token.line}). Got: ${raw}`);
  }
  if (n > 100) {
    throw new Error(`@repeat count exceeds maximum (100) (line ${token.line}). Got: ${n}`);
  }

  const { content: body, hasEnd } = parseIndentedBlock(ctx, { required: true, directiveName: "@repeat" });

  return {
    type: "repeat",
    line: token.line,
    column: token.column,
    count: n,
    body,
    hasEnd,
  } as any;
}

export function parseForeach(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const raw = parseRestOfLineRaw(ctx);
  if (!raw) {
    throw new Error(`@foreach requires syntax: @foreach <item> in <iterable> (line ${token.line})`);
  }

  const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(.+)$/);
  if (!m) {
    throw new Error(`Invalid @foreach syntax at line ${token.line}. Expected: @foreach <item> in <iterable>. Got: ${raw}`);
  }

  const item = m[1]!;
  const iterable = (m[2] ?? "").trim();
  if (!iterable) {
    throw new Error(`@foreach missing iterable at line ${token.line}`);
  }

  const { content: body, hasEnd } = parseIndentedBlock(ctx, { required: true, directiveName: "@foreach" });

  return {
    type: "foreach",
    line: token.line,
    column: token.column,
    item,
    iterable,
    body,
    hasEnd,
  } as any;
}

export function parseSet(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const raw = parseRestOfLineRaw(ctx);
  if (!raw) {
    throw new Error(`@set requires syntax: @set <variable> = <expression> (line ${token.line})`);
  }

  const m = raw.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*=\s*(.+)$/);
  if (!m) {
    throw new Error(`Invalid @set syntax at line ${token.line}. Expected: @set <variable> = <expression>. Got: ${raw}`);
  }

  const name = m[1]!;
  const expression = (m[2] ?? "").trim();
  if (!expression) {
    throw new Error(`@set missing expression at line ${token.line}`);
  }

  return {
    type: "set",
    line: token.line,
    column: token.column,
    name,
    expression,
  } as any;
}
