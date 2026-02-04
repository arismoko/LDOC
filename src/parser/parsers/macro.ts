import type { Node } from "../ast";
import { type ParserContext, parseRestOfLineRaw } from "./inline";
import { parseIndentedBlock } from "./helpers";

function parseDefineSignature(
  raw: string,
  line: number,
  column: number
): { name: string; params: string[]; optionalParams: Record<string, any> } {
  const m = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*(?:\((.*)\))?$/);
  if (!m) {
    throw new Error(`Invalid @define signature at line ${line}, column ${column}: ${raw}`);
  }
  const name = m[1]!;
  const inner = (m[2] ?? "").trim();
  if (!inner) return { name, params: [], optionalParams: {} };

  const params: string[] = [];
  const optionalParams: Record<string, any> = {};

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
    throw new Error(`Unterminated string in @define ${name} at line ${line}`);
  };
  const readBare = (): string => {
    const start = i;
    while (i < s.length && !/[\s,]/.test(s[i]!)) i++;
    return s.slice(start, i);
  };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;

    const paramName = readIdent();
    if (!paramName) throw new Error(`Expected param name in @define ${name} at line ${line}`);
    
    skipWs();
    if (s[i] === "=") {
      i++;
      skipWs();
      let value = "";
      if (s[i] === '"' || s[i] === "'") {
        value = readQuoted(s[i] as any);
      } else {
        value = readBare();
      }
      optionalParams[paramName] = value;
    }

    params.push(paramName);
    
    skipWs();
    if (s[i] === ",") {
      i++;
    }
  }

  const uniq = new Set(params);
  if (uniq.size !== params.length) {
    throw new Error(`Duplicate param in @define ${name} at line ${line}`);
  }

  return { name, params, optionalParams };
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

  const { name, params, optionalParams } = parseDefineSignature(sig, token.line, token.column);

  const { content: template, hasEnd, endToken } = parseIndentedBlock(ctx, { required: true, directiveName: "@define" });

  // Determine end position: use endToken if available, else last template node, else token
  let endLine = token.endLine;
  let endColumn = token.endColumn;
  if (endToken) {
    endLine = endToken.endLine;
    endColumn = endToken.endColumn;
  } else {
    const lastNode = template[template.length - 1];
    if (lastNode && lastNode.endLine !== undefined && lastNode.endColumn !== undefined) {
      endLine = lastNode.endLine;
      endColumn = lastNode.endColumn;
    }
  }

  return {
    type: "define",
    line: token.line,
    column: token.column,
    endLine,
    endColumn,
    name,
    params,
    optionalParams,
    template,
    hasEnd,
  } as any;
}

export function parseUse(ctx: ParserContext): Node {
  const token = ctx.stream.advance();
  const sig = parseRestOfLineRaw(ctx);
  if (!sig) {
    throw new Error(`@use requires a name at line ${token.line}, column ${token.column}`);
  }
  const { name, args, label } = parseUseSignature(sig, token.line, token.column);

  const { content: children, hasEnd, endToken } = parseIndentedBlock(ctx, { required: false });

  // Determine end position: use endToken if available, else last child node, else token
  let endLine = token.endLine;
  let endColumn = token.endColumn;
  if (endToken) {
    endLine = endToken.endLine;
    endColumn = endToken.endColumn;
  } else if (children.length > 0) {
    const lastNode = children[children.length - 1];
    if (lastNode && lastNode.endLine !== undefined && lastNode.endColumn !== undefined) {
      endLine = lastNode.endLine;
      endColumn = lastNode.endColumn;
    }
  }

  return {
    type: "use",
    line: token.line,
    column: token.column,
    endLine,
    endColumn,
    name,
    label,
    args,
    children: children.length > 0 ? children : undefined,
    hasEnd,
  } as any;
}
