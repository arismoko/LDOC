import type { Node } from "../ast";
import { type ParserContext } from "./inline";
import { parseIndentedBlock } from "./helpers";
import { parseDirectiveArgs } from "../args";

function argValueToString(val: any): string {
  if (!val) return "";
  switch (val.type) {
    case "string": return val.value;
    case "number": return String(val.value);
    case "boolean": return val.value ? "true" : "false";
    case "length": return val.raw;
    case "identifier": return val.name;
    case "expression": return val.raw;
    default: return "";
  }
}

export function parseDefine(ctx: ParserContext): Node {
  const token = ctx.stream.advance();

  const args = parseDirectiveArgs(ctx.stream);
  
  // V2 syntax only: @define(Name, param1, param2, optParam: default)
  if (args.positional.length === 0 && args.named.size === 0) {
    throw new Error(`@define requires v2 syntax: @define(Name, param1, param2) (line ${token.line})`);
  }
  
  const nameVal = args.positional[0];
  if (!nameVal || nameVal.type !== "identifier") {
    throw new Error(`@define requires a macro name as first argument (line ${token.line})`);
  }
  const name = nameVal.name;

  const params: string[] = [];
  for (const p of args.positional.slice(1)) {
    if (p.type !== "identifier") {
      throw new Error(`@define parameters must be identifiers (line ${token.line})`);
    }
    params.push(p.name);
  }

  const optionalParams: Record<string, any> = {};
  for (const [k, v] of args.named) {
    optionalParams[k] = argValueToString(v);
  }

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

  const callArgs = parseDirectiveArgs(ctx.stream);
  
  // V2 syntax only: @use(Name, arg: value, label: X)
  if (callArgs.positional.length === 0 && callArgs.named.size === 0) {
    throw new Error(`@use requires v2 syntax: @use(Name, arg: value) (line ${token.line})`);
  }
  
  const nameVal = callArgs.positional[0];
  if (!nameVal || nameVal.type !== "identifier") {
    throw new Error(`@use requires a macro name as first argument (line ${token.line})`);
  }
  const name = nameVal.name;
  
  let label: string | undefined;
  const labelVal = callArgs.named.get("label");
  if (labelVal) {
    if (labelVal.type === "identifier") label = labelVal.name;
    else if (labelVal.type === "string") label = labelVal.value;
    else {
      throw new Error(`@use label must be an identifier or string (line ${token.line})`);
    }
    callArgs.named.delete("label");
  }

  const args: Record<string, string> = {};
  for (const [k, v] of callArgs.named) {
    args[k] = argValueToString(v);
  }

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
