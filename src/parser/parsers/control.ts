import { TokenType } from "../lexer";
import type { Node } from "../ast";
import { type ParserContext, parseRestOfLineRaw } from "./inline";
import { pushBlankLines } from "../utils";

export function parseIf(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const condition = parseRestOfLineRaw(ctx);
  if (!condition) {
    throw new Error(`@if requires a condition at line ${token.line}, column ${token.column}`);
  }

  const thenBranch: Node[] = [];
  const elseBranch: Node[] = [];

  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (!la.indentAfter) {
    throw new Error(`@if must be followed by an indented block (line ${token.line})`);
  }

  // consume newline(s) up to indent
  ctx.stream.consumeNewlines();
  if (!ctx.stream.check(TokenType.INDENT)) {
    throw new Error(`@if expected an indented block (line ${token.line})`);
  }
  ctx.stream.advance();

  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
    if (ctx.stream.check(TokenType.END_BLOCK)) {
      throw new Error(`@; cannot close @if. Use @end (line ${ctx.stream.peek().line})`);
    }

    if (ctx.stream.check(TokenType.NEWLINE)) {
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(thenBranch, start.line, start.column, n);
      continue;
    }

    if (ctx.stream.check(TokenType.DEDENT)) break;
    const child = ctx.parseNode();
    if (child) thenBranch.push(child);
  }

  if (!ctx.stream.check(TokenType.DEDENT)) {
    throw new Error(`@if missing block end (line ${token.line})`);
  }
  ctx.stream.advance();

  // Optional else
  ctx.stream.skipNewlines();
  if (ctx.stream.check(TokenType.ELSE)) {
    ctx.stream.advance();

    const la2 = ctx.stream.lookaheadNewlinesThenIndent();
    if (!la2.indentAfter) {
      throw new Error(`@else must be followed by an indented block (line ${token.line})`);
    }
    ctx.stream.consumeNewlines();
    if (!ctx.stream.check(TokenType.INDENT)) {
      throw new Error(`@else expected an indented block (line ${token.line})`);
    }
    ctx.stream.advance();

    while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
      if (ctx.stream.check(TokenType.END_BLOCK)) {
        throw new Error(`@; cannot close @if. Use @end (line ${ctx.stream.peek().line})`);
      }

      if (ctx.stream.check(TokenType.NEWLINE)) {
        const start = ctx.stream.peek();
        const n = ctx.stream.consumeNewlines();
        pushBlankLines(elseBranch, start.line, start.column, n);
        continue;
      }

      if (ctx.stream.check(TokenType.DEDENT)) break;
      const child = ctx.parseNode();
      if (child) elseBranch.push(child);
    }

    if (!ctx.stream.check(TokenType.DEDENT)) {
      throw new Error(`@else missing block end (line ${token.line})`);
    }
    ctx.stream.advance();
  }

  ctx.stream.skipNewlines();
  if (!ctx.stream.check(TokenType.END)) {
    const t = ctx.stream.peek();
    throw new Error(`@if missing @end (line ${t.line}, column ${t.column})`);
  }
  ctx.stream.advance();
  // enforce no inline content after @end
  if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const rest = parseRestOfLineRaw(ctx);
    if (rest) {
      throw new Error(`@end does not take arguments (line ${token.line}). Got: ${rest}`);
    }
  }

  return {
    type: "if",
    line: token.line,
    column: token.column,
    condition,
    thenBranch,
    elseBranch,
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

  const body: Node[] = [];

  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (!la.indentAfter) {
    throw new Error(`@repeat must be followed by an indented block (line ${token.line})`);
  }

  ctx.stream.consumeNewlines();
  if (!ctx.stream.check(TokenType.INDENT)) {
    throw new Error(`@repeat expected an indented block (line ${token.line})`);
  }
  ctx.stream.advance();

  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
    if (ctx.stream.check(TokenType.END_BLOCK)) {
      throw new Error(`@; cannot close @repeat. Use @end (line ${ctx.stream.peek().line})`);
    }

    if (ctx.stream.check(TokenType.NEWLINE)) {
      const start = ctx.stream.peek();
      const nn = ctx.stream.consumeNewlines();
      pushBlankLines(body, start.line, start.column, nn);
      continue;
    }

    if (ctx.stream.check(TokenType.DEDENT)) break;
    const child = ctx.parseNode();
    if (child) body.push(child);
  }

  if (!ctx.stream.check(TokenType.DEDENT)) {
    throw new Error(`@repeat missing block end (line ${token.line})`);
  }
  ctx.stream.advance();

  ctx.stream.skipNewlines();
  if (!ctx.stream.check(TokenType.END)) {
    const t = ctx.stream.peek();
    throw new Error(`@repeat missing @end (line ${t.line}, column ${t.column})`);
  }
  ctx.stream.advance();
  if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const rest = parseRestOfLineRaw(ctx);
    if (rest) {
      throw new Error(`@end does not take arguments (line ${token.line}). Got: ${rest}`);
    }
  }

  return {
    type: "repeat",
    line: token.line,
    column: token.column,
    count: n,
    body,
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

  const body: Node[] = [];

  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (!la.indentAfter) {
    throw new Error(`@foreach must be followed by an indented block (line ${token.line})`);
  }

  ctx.stream.consumeNewlines();
  if (!ctx.stream.check(TokenType.INDENT)) {
    throw new Error(`@foreach expected an indented block (line ${token.line})`);
  }
  ctx.stream.advance();

  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
    if (ctx.stream.check(TokenType.END_BLOCK)) {
      throw new Error(`@; cannot close @foreach. Use @end (line ${ctx.stream.peek().line})`);
    }

    if (ctx.stream.check(TokenType.NEWLINE)) {
      const start = ctx.stream.peek();
      const nn = ctx.stream.consumeNewlines();
      pushBlankLines(body, start.line, start.column, nn);
      continue;
    }

    if (ctx.stream.check(TokenType.DEDENT)) break;
    const child = ctx.parseNode();
    if (child) body.push(child);
  }

  if (!ctx.stream.check(TokenType.DEDENT)) {
    throw new Error(`@foreach missing block end (line ${token.line})`);
  }
  ctx.stream.advance();

  ctx.stream.skipNewlines();
  if (!ctx.stream.check(TokenType.END)) {
    const t = ctx.stream.peek();
    throw new Error(`@foreach missing @end (line ${t.line}, column ${t.column})`);
  }
  ctx.stream.advance();
  if (!ctx.stream.check(TokenType.NEWLINE) && !ctx.stream.check(TokenType.EOF)) {
    const rest = parseRestOfLineRaw(ctx);
    if (rest) {
      throw new Error(`@end does not take arguments (line ${token.line}). Got: ${rest}`);
    }
  }

  return {
    type: "foreach",
    line: token.line,
    column: token.column,
    item,
    iterable,
    body,
  } as any;
}
