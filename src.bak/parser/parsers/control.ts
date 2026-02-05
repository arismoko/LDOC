import { TokenType } from "../lexer";
import type { Node } from "../ast";
import { type ParserContext } from "./inline";
import { parseIndentedBlock } from "./helpers";
import { extractCount, extractForeachArgs, parseDirectiveArgs } from "../args";

function argValueToExpr(val: any): string {
  if (!val) return "";
  switch (val.type) {
    case "expression": return val.raw;
    case "identifier": return val.name;
    case "string": return JSON.stringify(val.value);
    case "number": return String(val.value);
    case "boolean": return val.value ? "true" : "false";
    case "length": return val.raw;
    default: return "";
  }
}

export function parseIf(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const args = parseDirectiveArgs(ctx.stream);
  if (args.positional.length === 0) {
    throw new Error(`@if requires v2 syntax: @if(condition) at line ${token.line}, column ${token.column}`);
  }
  const condition = argValueToExpr(args.positional[0]);

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
    const elseifArgs = parseDirectiveArgs(ctx.stream);
    if (elseifArgs.positional.length === 0) {
      throw new Error(`@elseif requires v2 syntax: @elseif(condition) at line ${elseifToken.line}, column ${elseifToken.column}`);
    }
    const elseifCond = argValueToExpr(elseifArgs.positional[0]);

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
  const args = parseDirectiveArgs(ctx.stream);
  if (args.positional.length === 0) {
    throw new Error(`@repeat requires v2 syntax: @repeat(count) at line ${token.line}, column ${token.column}`);
  }
  const n = extractCount(args, "repeat", token.line);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`@repeat count must be a non-negative integer (line ${token.line}). Got: ${String(n)}`);
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
  const args = parseDirectiveArgs(ctx.stream);
  if (args.positional.length === 0 && args.named.size === 0) {
    throw new Error(`@foreach requires v2 syntax: @foreach(item, in: collection) at line ${token.line}, column ${token.column}`);
  }
  const { item, iterable } = extractForeachArgs(args, token.line);

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
  const args = parseDirectiveArgs(ctx.stream);
  
  if (args.positional.length === 0 && args.named.size === 0) {
    throw new Error(`@set requires v2 syntax: @set(variable, value: expression) at line ${token.line}, column ${token.column}`);
  }
  
  const first = args.positional[0];
  let name = "";
  if (first?.type === "identifier") {
    name = first.name;
  } else if (first?.type === "expression") {
    // Handle dot paths like user.name which are parsed as expressions
    name = first.raw;
  } else {
    throw new Error(`@set requires a variable name as first argument (line ${token.line})`);
  }
  const value = args.named.get("value");
  if (!value) {
    throw new Error(`@set requires named argument value: <expression> (line ${token.line})`);
  }
  const expression = argValueToExpr(value);
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
