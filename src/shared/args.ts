import { error } from '../types/diagnostics';
import type { Diagnostic } from '../types/diagnostics';
import type { SourceLocation } from '../types/source-location.ts';

export interface ParseArgsResult {
  ok: false;
  raw: string;
  error: Diagnostic;
}

export interface ArgsObject {
  [key: string]: JSON5Value;
}

export type JSON5Value = string | number | boolean | null | ArgsObject | ArgsObject[];

export function parseArgsObject(argsRaw: string, location: SourceLocation): ArgsObject | ParseArgsResult {
  try {
    let trimmed = argsRaw.trim();
    if (trimmed === '') {
      return {};
    }

    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return {
        ok: false,
        raw: argsRaw,
        error: error('PARSE_ERROR', `Args must be enclosed in { }`, location),
      };
    }

    trimmed = trimmed.slice(1, -1).trim();
    if (trimmed === '') {
      return {};
    }

    const result = parseJSON5Object(trimmed);
    if (!result.ok) {
      return {
        ok: false,
        raw: argsRaw,
        error: result.error || error('PARSE_ERROR', 'Failed to parse args', location),
      };
    }

    return result.value || {};
  } catch (err) {
    return {
      ok: false,
      raw: argsRaw,
      error: error('PARSE_ERROR', err instanceof Error ? err.message : 'Failed to parse args', location),
    };
  }
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
  value: any;
}

interface ParseValueResult extends ParseResultBase {
  value: any;
}

interface ParseArrayResult extends ParseResultBase {
  value: any;
}

function parseJSON5Object(input: string): ParseJSON5Result {
  const result: ArgsObject = {};
  let i = 0;
  const length = input.length;

  while (i < length) {
    skipWhitespace(input, i);
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
        error: error('PARSE_ERROR', 'Invalid member', { line: 1, column: 0, endLine: 1, endColumn: i }),
        end: i,
      };
    }

    const key = member.key.line;
    if (result.hasOwnProperty(key)) {
      return {
        ok: false,
        error: error('DUPLICATE_DEFINITION', `Duplicate key "${key}"`, member.key),
        end: i,
      };
    }

    result[key] = member.value;
    i = memberResult.end;

    skipWhitespace(input, i);
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

  return {
    ok: false,
    error: error('PARSE_ERROR', 'Unexpected end of args object', { line: 1, column: 0, endLine: 1, endColumn: input.length }),
    end: i,
  };
}

function parseMember(input: string, start: number): ParseMemberResult {
  let i = start;

  const keyResult = parseKey(input, i);
  if (!keyResult.ok) {
    return keyResult;
  }

  i = keyResult.end;
  skipWhitespace(input, i);
  if (i >= input.length || input[i] !== ':') {
    return {
      ok: false,
      error: error('PARSE_ERROR', 'Expected ":" after key', keyResult.value),
      end: i,
      value: undefined,
    };
  }

  i++;
  skipWhitespace(input, i);

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
  let startPos = i;

  skipWhitespace(input, i);

  if (i >= input.length) {
    return {
      ok: false,
      error: error('PARSE_ERROR', 'Expected key name', { line: 1, column: start, endLine: 1, endColumn: start }),
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
        error: error('PARSE_ERROR', 'Unterminated quoted key', { line: 1, column: startPos, endLine: 1, endColumn: i }),
        end: i,
        value: undefined,
      };
    }
  const keyStr = input.slice(startPos + 1, i - 1);
  if (!keyStr) {
    return {
      ok: false,
      error: error('PARSE_ERROR', 'Empty key name', { line: 1, column: startPos + 1, endLine: 1, endColumn: i - 1 }),
      end: i + 1,
      value: undefined as any,
    };
  }
    return {
      ok: true,
      value: { line: 1, column: startPos, endLine: 1, endColumn: i },
      end: i + 1,
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
        error: error('PARSE_ERROR', `Unexpected literal "${keyStr}" as key name`, { line: 1, column: startPos, endLine: 1, endColumn: i }),
        end: i,
        value: undefined as any,
      };
    }
    return {
      ok: true,
      value: { line: 1, column: startPos, endLine: 1, endColumn: i },
      end: i,
    };
  }

  return {
    ok: false,
    error: error('PARSE_ERROR', 'Expected quoted or unquoted key name', { line: 1, column: i, endLine: 1, endColumn: i + 1 }),
    end: i,
    value: undefined,
  };
}

function parseValue(input: string, start: number): ParseValueResult {
  let i = start;
  skipWhitespace(input, i);

  if (i >= input.length) {
    return {
      ok: false,
      error: error('PARSE_ERROR', 'Expected value', { line: 1, column: start, endLine: 1, endColumn: start }),
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
        error: error('PARSE_ERROR', 'Unterminated string value', { line: 1, column: start, endLine: 1, endColumn: i }),
        end: i,
        value: undefined,
      };
    }
    return { ok: true, value: input.slice(start + 1, i), end: i + 1 };
  }

  if (char === '[') {
    const result = parseArray(input, i) as any;
    return result;
  }

  if (char === '{') {
    const result = parseJSON5Object(input.slice(i + 1).trim()) as any;
    if (!result.ok) {
      return result;
    }
    return {
      ok: true,
      value: result.value || {},
      end: i + 1,
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
        error: error('PARSE_ERROR', 'Invalid number', { line: 1, column: numStart, endLine: 1, endColumn: i }),
        end: i,
        value: undefined,
      };
    }
    return { ok: true, value: num, end: i };
  }

  return {
    ok: false,
    error: error('PARSE_ERROR', 'Expected value', { line: 1, column: i, endLine: 1, endColumn: i + 1 }),
    end: i,
    value: undefined,
  };
}

function parseArray(input: string, start: number): ParseArrayResult {
  let i = start + 1;
  const result: JSON5Value[] = [];
  const length = input.length;

  while (i < length) {
    skipWhitespace(input, i);
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

    skipWhitespace(input, i);
    if (i >= length) break;

    if (input[i] === ',') {
      i++;
      continue;
    }

    if (input[i] === ']') {
      i++;
      break;
    }
  }

  return {
    ok: false,
    error: error('PARSE_ERROR', 'Unexpected end of array', { line: 1, column: start, endLine: 1, endColumn: length }),
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
