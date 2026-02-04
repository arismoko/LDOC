import { TokenType } from "../lexer";
import type { Node } from "../ast";
import { type ParserContext, parseRestOfLineRaw } from "./inline";
import { pushBlankLines, consumeEndBlockOrThrow } from "../utils";

function parseDefineSignature(
  raw: string,
  line: number,
  column: number
): { name: string; params: string[] } {
  const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*(?:\((.*)\))?$/);
  if (!m) {
    throw new Error(`Invalid @define signature at line ${line}, column ${column}: ${raw}`);
  }
  const name = m[1]!;
  const inner = (m[2] ?? "").trim();
  if (!inner) return { name, params: [] };

  const params = inner
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const p of params) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p)) {
      throw new Error(`Invalid param name '${p}' in @define ${name} at line ${line}`);
    }
  }

  const uniq = new Set(params);
  if (uniq.size !== params.length) {
    throw new Error(`Duplicate param in @define ${name} at line ${line}`);
  }

  return { name, params };
}

function parseUseSignature(
  raw: string,
  line: number,
  column: number
): { name: string; args: Record<string, string>; label?: string } {
  // Support: @use Name(...)
  // Support: @use Name(...) as Label
  // Support: @use Name as Label
  const trimmed = raw.trim();

  let main = trimmed;
  let label: string | undefined;

  // Split optional ` as Label` from the end (Label cannot contain spaces)
  const asMatch = trimmed.match(/\s+as\s+([A-Za-z][A-Za-z0-9_]*)\s*$/);
  if (asMatch) {
    label = asMatch[1];
    main = trimmed.slice(0, asMatch.index).trim();
  }

  const m = main.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*(?:\((.*)\))?$/);
  if (!m) {
    throw new Error(`Invalid @use signature at line ${line}, column ${column}: ${raw}`);
  }
  const name = m[1]!;
  const inner = (m[2] ?? "").trim();
  if (!inner) return { name, args: {}, label };

  const args: Record<string, string> = {};

  // Parse key=value pairs, comma-separated (commas optional between pairs)
  // Values: "..." or '...' (supports escaping \" and \\), or unquoted token (no spaces/commas)
  let i = 0;
  const s = inner;
  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };
  const readIdent = (): string => {
    const start = i;
    while (i < s.length && /[A-Za-z0-9_]/.test(s[i]!)) i++;
    return s.slice(start, i);
  };
  const readQuoted = (quote: '"' | "'"): string => {
    i++; // opening
    let out = "";
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === undefined) break;
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        i++;
        return out;
      }
      out += ch;
      i++;
    }
    throw new Error(`Unterminated string in @use ${name} at line ${line}`);
  };
  const readBare = (): string => {
    const start = i;
    while (i < s.length && !/[\s,]/.test(s[i]!)) i++;
    return s.slice(start, i);
  };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;

    const key = readIdent();
    if (!key) throw new Error(`Expected arg name in @use ${name} at line ${line}`);
    skipWs();
    if (s[i] !== "=") throw new Error(`Expected '=' after ${key} in @use ${name} at line ${line}`);
    i++;
    skipWs();

    let value = "";
    if (s[i] === '"' || s[i] === "'") {
      value = readQuoted(s[i] as any);
    } else {
      value = readBare();
    }

    args[key] = value;
    skipWs();
    if (s[i] === ",") {
      i++;
    }
  }

  return { name, args, label };
}

export function parseDefine(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const sig = parseRestOfLineRaw(ctx);
  if (!sig) {
    throw new Error(`@define requires a name at line ${token.line}, column ${token.column}`);
  }

  const { name, params } = parseDefineSignature(sig, token.line, token.column);

  const template: Node[] = [];

  const la = ctx.stream.lookaheadNewlinesThenIndent();
  if (!la.indentAfter) {
    throw new Error(`@define ${name} must be followed by an indented block`);
  }

  // consume newline(s) up to indent
  ctx.stream.consumeNewlines();

  // parseMetaBlock() expects INDENT at current pos, so we should be positioned at INDENT
  if (!ctx.stream.check(TokenType.INDENT)) {
    throw new Error(`@define ${name} expected an indented block`);
  }
  ctx.stream.advance(); // INDENT

  while (!ctx.stream.isAtEnd() && !ctx.stream.check(TokenType.DEDENT)) {
    if (ctx.stream.check(TokenType.END_BLOCK)) {
      consumeEndBlockOrThrow(ctx, "define");
      break;
    }

    if (ctx.stream.check(TokenType.NEWLINE)) {
      const start = ctx.stream.peek();
      const n = ctx.stream.consumeNewlines();
      pushBlankLines(template, start.line, start.column, n);
      continue;
    }

    if (ctx.stream.check(TokenType.DEDENT)) break;

    const child = ctx.parseNode();
    if (child) template.push(child);
  }

  if (ctx.stream.check(TokenType.DEDENT)) ctx.stream.advance();

  return {
    type: "define",
    line: token.line,
    column: token.column,
    name,
    params,
    optionalParams: {},
    template,
  } as any;
}

export function parseUse(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const sig = parseRestOfLineRaw(ctx);
  if (!sig) {
    throw new Error(`@use requires a name at line ${token.line}, column ${token.column}`);
  }
  const { name, args, label } = parseUseSignature(sig, token.line, token.column);
  return {
    type: "use",
    line: token.line,
    column: token.column,
    name,
    label,
    args,
  } as any;
}
