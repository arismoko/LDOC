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
    const lastChild = thenBranch[thenBranch.length - 1];
    return {
      type: "if",
      line: token.line,
      column: token.column,
      endLine: lastChild?.endLine ?? token.endLine,
      endColumn: lastChild?.endColumn ?? token.endColumn,
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
  let endLine = token.endLine;
  let endColumn = token.endColumn;

  // Track end from thenBranch initially
  const lastThenChild = thenBranch[thenBranch.length - 1];
  if (lastThenChild) {
    endLine = lastThenChild.endLine ?? endLine;
    endColumn = lastThenChild.endColumn ?? endColumn;
  }

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
      endLine: elseifToken.endLine,
      endColumn: elseifToken.endColumn,
      condition: elseifCond,
      thenBranch: elseifThen,
      elseBranch: [],
    };

    // Update nestedIf end position from its children
    const lastElseifChild = elseifThen[elseifThen.length - 1];
    if (lastElseifChild) {
      nestedIf.endLine = lastElseifChild.endLine ?? nestedIf.endLine;
      nestedIf.endColumn = lastElseifChild.endColumn ?? nestedIf.endColumn;
    }

    currentElseBranch.push(nestedIf);
    currentElseBranch = nestedIf.elseBranch;

    // Update parent end position
    endLine = nestedIf.endLine ?? endLine;
    endColumn = nestedIf.endColumn ?? endColumn;

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
    const lastElseChild = elseBranchContent[elseBranchContent.length - 1];
    if (lastElseChild) {
      endLine = lastElseChild.endLine ?? endLine;
      endColumn = lastElseChild.endColumn ?? endColumn;
    }
  }

  return {
    type: "if",
    line: token.line,
    column: token.column,
    endLine,
    endColumn,
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
  const lastChild = body[body.length - 1];

  return {
    type: "repeat",
    line: token.line,
    column: token.column,
    endLine: lastChild?.endLine ?? token.endLine,
    endColumn: lastChild?.endColumn ?? token.endColumn,
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
  const lastChild = body[body.length - 1];

  return {
    type: "foreach",
    line: token.line,
    column: token.column,
    endLine: lastChild?.endLine ?? token.endLine,
    endColumn: lastChild?.endColumn ?? token.endColumn,
    item,
    iterable,
    body,
    hasEnd,
  } as any;
}

export function parseSet(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const startPos = ctx.stream.getPosition();
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

  // Get end position from last consumed token
  const endPos = ctx.stream.getPosition();
  const endToken = endPos > startPos ? ctx.stream.getTokenAt(endPos - 1) : token;

  return {
    type: "set",
    line: token.line,
    column: token.column,
    endLine: endToken?.endLine ?? token.endLine,
    endColumn: endToken?.endColumn ?? token.endColumn,
    name,
    expression,
  } as any;
}
