import { error, DiagnosticCode } from '../types/diagnostics';
import type { Diagnostic } from '../types/diagnostics';
import type { SourceLocation } from '../types/source-location.ts';

export interface ParseArgsError {
  ok: false;
  raw: string;
  error: Diagnostic;
}

export interface ParseArgsSuccess {
  ok: true;
  value: ArgsObject;
}

export type ParseArgsResult = ParseArgsSuccess | ParseArgsError;

export interface ArgsObject {
  [key: string]: JSON5Value;
}

export type JSON5Value = string | number | boolean | null | ArgsObject | ArgsObject[];

export function parseArgsObject(argsRaw: string, location: SourceLocation): ParseArgsResult {
  try {
    const trimmed = argsRaw.trim();
    if (trimmed === '') {
      return { ok: true, value: {} };
    }

    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return {
        ok: false,
        raw: argsRaw,
        error: error(DiagnosticCode.PARSE_ERROR, `Args must be enclosed in { }`, location),
      };
    }

    const inner = trimmed.slice(1, -1);
    const innerLeadingWS = inner.length - inner.trimStart().length;
    const innerTrimmed = inner.trim();
    if (innerTrimmed === '') {
      return { ok: true, value: {} };
    }

    const result = parseJSON5Object(innerTrimmed);
    if (!result.ok) {
      // Rebase inner parser location to source coordinates.
      // location points at the LPAREN; inner locations use flat offsets (line: 1, column: offset).
      // Walk through the original inner args text (between parens) to map offsets.
      const innerLoc = result.error?.location;
      let rebasedLoc: SourceLocation;
      if (innerLoc) {
        // Start at first char after LPAREN, then skip leading whitespace inside parens.
        const innerStart = advancePosition(inner, location.line, location.column + 1, innerLeadingWS);
        const start = advancePosition(innerTrimmed, innerStart.line, innerStart.column, innerLoc.column);
        const end = advancePosition(innerTrimmed, innerStart.line, innerStart.column, innerLoc.endColumn);
        rebasedLoc = {
          line: start.line,
          column: start.column,
          endLine: end.line,
          endColumn: end.column,
          source: location.source,
        };
      } else {
        rebasedLoc = location;
      }
      return {
        ok: false,
        raw: argsRaw,
        error: error(result.error?.code ?? DiagnosticCode.PARSE_ERROR, result.error?.message ?? 'Failed to parse args', rebasedLoc),
      };
    }

    return { ok: true, value: result.value || {} };
  } catch (err) {
    return {
      ok: false,
      raw: argsRaw,
      error: error(DiagnosticCode.PARSE_ERROR, err instanceof Error ? err.message : 'Failed to parse args', location),
    };
  }
}

/**
 * Walk through `text` for `offset` characters, tracking newlines to compute
 * the resulting line/column position relative to a starting line/column.
 */
function advancePosition(
  text: string,
  startLine: number,
  startColumn: number,
  offset: number
): { line: number; column: number } {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = startLine;
  let column = startColumn;
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') {
      line++;
      column = 0;
    } else {
      column++;
    }
  }
  return { line, column };
}

interface ParseResultBase {
  ok: boolean;
  end: number;
  error?: Diagnostic;
  value?: any;
}

interface ParseJSON5Result extends ParseResultBase {
  value?: ArgsObject;
}

interface ParseMemberResult extends ParseResultBase {
  value?: any;
}

interface ParseKeyResult extends ParseResultBase {
  value: { text: string; column: number; endColumn: number };
}

interface ParseValueResult extends ParseResultBase {
  value: any;
}

interface ParseArrayResult extends ParseResultBase {
  value: any;
}

function parseJSON5Object(input: string): ParseJSON5Result {
  const result: ArgsObject = Object.create(null) as ArgsObject;
  let i = 0;
  const length = input.length;

  while (i < length) {
    i = skipWhitespace(input, i);
    if (i >= length) break;

    const char = input[i];

    if (char === '}') {
      i++;
      return { ok: true, value: result, end: i };
    }

    if (char === ',') {
      i++;
      continue;
    }

    const memberResult = parseMember(input, i) as any;
    if (!memberResult.ok) {
      return memberResult;
    }

    const member = memberResult.value;
    if (!member) {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, 'Invalid member', { line: 1, column: 0, endLine: 1, endColumn: i }),
        end: i,
      };
    }

    const key = member.key;
    const keyText = key.text;
    if (keyText in result) {
      return {
        ok: false,
        error: error(DiagnosticCode.DUPLICATE_DEFINITION, `Duplicate key "${keyText}"`, { line: 1, column: key.column, endLine: 1, endColumn: key.endColumn }),
        end: i,
      };
    }

    result[keyText] = member.value;
    i = memberResult.end;

    i = skipWhitespace(input, i);
    if (i >= length) break;

    if (input[i] === ',') {
      i++;
      continue;
    }

    if (input[i] === '}') {
      i++;
      break;
    }
  }

  // Successfully consumed all input — this is valid for top-level args
  return { ok: true, value: result, end: i };
}

function parseMember(input: string, start: number): ParseMemberResult {
  let i = start;

  const keyResult = parseKey(input, i);
  if (!keyResult.ok) {
    return keyResult;
  }

  i = keyResult.end;
  i = skipWhitespace(input, i);
  if (i >= input.length || input[i] !== ':') {
    return {
      ok: false,
      error: error(DiagnosticCode.PARSE_ERROR, `Expected ":" after key "${keyResult.value.text}"`, { line: 1, column: keyResult.value.column, endLine: 1, endColumn: keyResult.value.endColumn }),
      end: i,
      value: undefined,
    };
  }

  i++;
  i = skipWhitespace(input, i);

  const valueResult = parseValue(input, i) as any;
  if (!valueResult.ok) {
    return valueResult;
  }

  return {
    ok: true,
    value: { key: keyResult.value, value: valueResult.value },
    end: valueResult.end,
  };
}

function parseKey(input: string, start: number): ParseKeyResult {
  let i = start;

  i = skipWhitespace(input, i);
  let startPos = i;

  if (i >= input.length) {
    return {
      ok: false,
      error: error(DiagnosticCode.PARSE_ERROR, 'Expected key name', { line: 1, column: start, endLine: 1, endColumn: start }),
      end: i,
      value: { text: '', column: start, endColumn: start },
    };
  }

  const char = input[i];
  if (char === '"' || char === "'") {
    i++;
    let foundEnd = false;
    while (i < input.length) {
      if (input[i] === char) {
        i++;
        foundEnd = true;
        break;
      }
      if (input[i] === '\\' && i + 1 < input.length) {
        i += 2;
      } else {
        i++;
      }
    }
    if (!foundEnd) {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, 'Unterminated quoted key', { line: 1, column: startPos, endLine: 1, endColumn: i }),
        end: i,
        value: { text: '', column: startPos, endColumn: i },
      };
    }
    const keyStr = input.slice(startPos + 1, i - 1);
    if (!keyStr) {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, 'Empty key name', { line: 1, column: startPos + 1, endLine: 1, endColumn: i - 1 }),
        end: i,
        value: { text: '', column: startPos, endColumn: i },
      };
    }
    return {
      ok: true,
      value: { text: keyStr, column: startPos, endColumn: i },
      end: i,
    };
  }

  if (isIdentifierStart(char!)) {
    i++;
    while (true) {
      if (i >= input.length || !isIdentifierPart(input[i]!)) break;
      i++;
    }
    const keyStr = input.slice(startPos, i) || '';
    if (keyStr === 'true' || keyStr === 'false' || keyStr === 'null') {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, `Unexpected literal "${keyStr}" as key name`, { line: 1, column: startPos, endLine: 1, endColumn: i }),
        end: i,
        value: { text: '', column: startPos, endColumn: i },
      };
    }
    return {
      ok: true,
      value: { text: keyStr, column: startPos, endColumn: i },
      end: i,
    };
  }

  return {
    ok: false,
    error: error(DiagnosticCode.PARSE_ERROR, 'Expected quoted or unquoted key name', { line: 1, column: i, endLine: 1, endColumn: i + 1 }),
    end: i,
    value: { text: '', column: i, endColumn: i + 1 },
  };
}

function parseValue(input: string, start: number): ParseValueResult {
  let i = skipWhitespace(input, start);

  if (i >= input.length) {
    return {
      ok: false,
      error: error(DiagnosticCode.PARSE_ERROR, 'Expected value', { line: 1, column: start, endLine: 1, endColumn: start }),
      end: i,
      value: undefined,
    };
  }

  const char = input[i];

  if (char === '"' || char === "'") {
    i++;
    let foundEnd = false;
    while (i < input.length) {
      if (input[i] === char) {
        i++;
        foundEnd = true;
        break;
      }
      if (input[i] === '\\' && i + 1 < input.length) {
        i += 2;
      } else {
        i++;
      }
    }
    if (!foundEnd) {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, 'Unterminated string value', { line: 1, column: start, endLine: 1, endColumn: i }),
        end: i,
        value: undefined,
      };
    }
    return { ok: true, value: input.slice(start + 1, i - 1), end: i };
  }

  if (char === '[') {
    const result = parseArray(input, i) as any;
    return result;
  }

  if (char === '{') {
    // Find the matching closing brace, respecting nesting and strings
    let depth = 1;
    let j = i + 1;
    while (j < input.length && depth > 0) {
      const c = input[j];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' || c === "'") {
        // Skip quoted strings
        j++;
        while (j < input.length && input[j] !== c) {
          if (input[j] === '\\') j++;
          j++;
        }
      }
      if (depth > 0) j++;
    }
    // j now points at the closing }
    const innerContent = input.slice(i + 1, j).trim();
    if (innerContent === '') {
      return { ok: true, value: {}, end: j + 1 };
    }
    const result = parseJSON5Object(innerContent);
    if (!result.ok) {
      return { ok: false, end: result.end, error: result.error, value: undefined };
    }
    return {
      ok: true,
      value: result.value || {},
      end: j + 1,
    };
  }

  if (char === 't' && input.slice(i, i + 4) === 'true') {
    return { ok: true, value: true, end: i + 4 };
  }

  if (char === 'f' && input.slice(i, i + 5) === 'false') {
    return { ok: true, value: false, end: i + 5 };
  }

  if (char === 'n' && input.slice(i, i + 4) === 'null') {
    return { ok: true, value: null, end: i + 4 };
  }

  const numStart = i;
  while (i < input.length && (isDigit(input[i]!) || input[i]! === '.' || input[i]! === '-' || input[i]! === '+')) {
    i++;
  }

  if (i > numStart) {
    const numStr = input.slice(numStart, i);
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      return {
        ok: false,
        error: error(DiagnosticCode.PARSE_ERROR, 'Invalid number', { line: 1, column: numStart, endLine: 1, endColumn: i }),
        end: i,
        value: undefined,
      };
    }
    return { ok: true, value: num, end: i };
  }

  return {
    ok: false,
    error: error(DiagnosticCode.PARSE_ERROR, 'Expected value', { line: 1, column: i, endLine: 1, endColumn: i + 1 }),
    end: i,
    value: undefined,
  };
}

function parseArray(input: string, start: number): ParseArrayResult {
  let i = start + 1;
  const result: JSON5Value[] = [];
  const length = input.length;

  while (i < length) {
    i = skipWhitespace(input, i);
    if (i >= length) break;

    const char = input[i];

    if (char === ']') {
      i++;
      return { ok: true, value: result, end: i };
    }

    if (char === ',') {
      i++;
      continue;
    }

    const valueResult = parseValue(input, i) as any;
    if (!valueResult.ok) {
      return valueResult;
    }

    result.push(valueResult.value);
    i = valueResult.end;

    i = skipWhitespace(input, i);
    if (i >= length) break;

    if (input[i] === ',') {
      i++;
      continue;
    }

    if (input[i] === ']') {
      i++;
      return { ok: true, value: result, end: i };
    }
  }

  return {
    ok: false,
    error: error(DiagnosticCode.PARSE_ERROR, 'Unexpected end of array', { line: 1, column: start, endLine: 1, endColumn: length }),
    end: i,
    value: undefined,
  };
}

function skipWhitespace(input: string, i: number): number {
  const length = input.length;
  while (i < length && isWhitespace(input[i]!)) {
    i++;
  }
  return i;
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function isDigit(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isIdentifierStart(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentifierPart(char: string): boolean {
  const code = char.charCodeAt(0);
  return isIdentifierStart(char) || (code >= 48 && code <= 57);
}
