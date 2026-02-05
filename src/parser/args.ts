import { TokenType } from "./lexer/patterns";
import { TokenStream } from "./token-stream";

export type ArgValue =
  | { type: "number"; value: number }
  | { type: "length"; value: number; unit: LengthUnit; raw: string }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "list"; items: ArgValue[] }
  | { type: "expression"; raw: string }
  | { type: "identifier"; name: string };

export type LengthUnit = "in" | "pt" | "cm" | "mm" | "twip";

export interface DirectiveArgs {
  positional: ArgValue[];
  named: Map<string, ArgValue>;
  flags: Set<string>;
}

export const EMPTY_ARGS: DirectiveArgs = {
  positional: [],
  named: new Map(),
  flags: new Set(),
};

export function parseDirectiveArgs(stream: TokenStream): DirectiveArgs {
  const args: DirectiveArgs = {
    positional: [],
    named: new Map(),
    flags: new Set(),
  };
  
  // Check for LPAREN
  if (!stream.check(TokenType.LPAREN)) {
    return EMPTY_ARGS;
  }
  stream.advance(); // (
  
  while (!stream.check(TokenType.RPAREN) && !stream.isAtEnd()) {
    if (stream.check(TokenType.COMMA)) {
      stream.advance();
      continue;
    }
    
    // Named arg: identifier : value
    if (stream.check(TokenType.IDENTIFIER_ARG)) {
      const keyTok = stream.peek();
      const nextTok = stream.getTokenAt(stream.getPosition() + 1);
      if (nextTok?.type === TokenType.COLON_ARG) {
        stream.advance(); // key
        stream.advance(); // :
        const value = parseValue(stream);
        args.named.set(keyTok.value, value);
        continue;
      }
    }

    const value = parseValue(stream);
    args.positional.push(value);
    if (value.type === "identifier") {
      // Treat bare identifiers as both positional values and convenience flags.
      args.flags.add(value.name);
    }
  }
  
  stream.consume(TokenType.RPAREN, "Expected ')' to close argument list");
  return args;
}

function parseValue(stream: TokenStream): ArgValue {
  const token = stream.peek();
  
  switch (token.type) {
    case TokenType.NUMBER:
      stream.advance();
      return { type: "number", value: parseFloat(token.value) };
      
    case TokenType.LENGTH:
      stream.advance();
      return parseLengthValue(token.value);
      
    case TokenType.STRING_LITERAL:
      stream.advance();
      // Remove quotes
      return { type: "string", value: token.value.slice(1, -1) };
      
    case TokenType.BOOLEAN:
      stream.advance();
      return { type: "boolean", value: token.value === "true" };
      
    case TokenType.LBRACKET_ARG:
      return parseList(stream);
      
    case TokenType.EXPRESSION:
      stream.advance();
      return { type: "expression", raw: token.value };
      
    case TokenType.IDENTIFIER_ARG:
      stream.advance();
      return { type: "identifier", name: token.value };
      
    default:
      throw new Error(`Unexpected token in argument: ${token.type} (value: ${token.value})`);
  }
}

function parseList(stream: TokenStream): ArgValue {
  stream.advance(); // [
  const items: ArgValue[] = [];
  
  while (!stream.check(TokenType.RBRACKET_ARG) && !stream.isAtEnd()) {
    if (stream.check(TokenType.COMMA)) {
      stream.advance();
      continue;
    }
    items.push(parseValue(stream));
  }
  
  stream.consume(TokenType.RBRACKET_ARG, "Expected ']' to close list");
  return { type: "list", items };
}

function parseLengthValue(raw: string): ArgValue {
  // Parse "2in", "12pt"
  const match = raw.match(/^(\d+(?:\.\d+)?)([a-z]+)$/i);
  if (!match) {
    throw new Error(`Invalid length format: ${raw}`);
  }
  const n = match[1];
  const unitRaw = match[2];
  if (!n || !unitRaw) {
    throw new Error(`Invalid length format: ${raw}`);
  }
  const value = parseFloat(n);
  const unit = unitRaw.toLowerCase() as LengthUnit;
  return { type: "length", value, unit, raw };
}

// Helpers

export function extractCount(args: DirectiveArgs, directive: string, line: number): number {
  const val = args.positional[0];
  if (!val || val.type !== "number") {
    throw new Error(`@${directive} requires a number argument (line ${line})`);
  }
  return val.value;
}

export function extractLength(args: DirectiveArgs, key: string, defaultTwip: number): number {
  const val = args.named.get(key);
  if (!val) return defaultTwip;
  if (val.type !== "length") {
    // Try parsing number as points if just number? No, strict types.
    throw new Error(`${key} must be a length value`);
  }
  // Convert to twips (approximate for now, or use a utility)
  // 1in = 1440 twips
  // 1pt = 20 twips
  // 1cm = 567 twips
  // 1mm = 56.7 twips
  return convertToTwips(val.value, val.unit);
}

function convertToTwips(value: number, unit: LengthUnit): number {
  switch (unit) {
    case "in": return value * 1440;
    case "pt": return value * 20;
    case "cm": return value * 567;
    case "mm": return value * 56.7;
    case "twip": return value;
    default: return value;
  }
}

export function extractForeachArgs(args: DirectiveArgs, line: number): { item: string; iterable: string } {
  const itemVal = args.positional[0];
  if (!itemVal || itemVal.type !== "identifier") {
    throw new Error(`@foreach requires an item variable (line ${line})`);
  }
  
  const inVal = args.named.get("in");
  if (!inVal || (inVal.type !== "identifier" && inVal.type !== "expression")) {
    throw new Error(`@foreach requires 'in: collection' (line ${line})`);
  }
  
  return {
    item: itemVal.name,
    iterable: inVal.type === "identifier" ? inVal.name : inVal.raw,
  };
}
