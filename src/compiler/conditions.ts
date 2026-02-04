// Condition evaluation helpers for template/control-flow

/**
 * Resolve a dot-path on an object tree.
 * Returns undefined if any segment is missing.
 */
export const getPathValue = (root: any, path: string[]): any => {
  let v = root;
  for (const key of path) {
    if (v && typeof v === "object" && key in v) v = v[key];
    else return undefined;
  }
  return v;
};

/**
 * Parse a literal string into its appropriate JavaScript value.
 * Handles booleans, null, numbers, and quoted strings.
 */
export const parseLiteral = (raw: string): any => {
  const s = raw.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  // quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
};

/**
 * Determine if a value is truthy in the DSL's condition semantics.
 */
export const truthy = (v: any): boolean => {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !Number.isNaN(v);
  if (typeof v === "string") return v.length > 0 && v.toLowerCase() !== "false";
  if (Array.isArray(v)) return v.length > 0;
  return true;
};

/**
 * Tokenize a condition expression into tokens.
 * Handles quoted strings, operators (==, !=, !), and identifiers.
 */
export const tokenizeCond = (raw: string): string[] => {
  const s = raw.trim();
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let buf = "";
      while (i < s.length) {
        const c = s.charAt(i);
        if (c === "\\") {
          if (i + 1 >= s.length) break;
          buf += s.charAt(i + 1);
          i += 2;
          continue;
        }
        if (c === quote) {
          i++;
          break;
        }
        buf += c;
        i++;
      }
      out.push(`"${buf}"`);
      continue;
    }
    if (s.startsWith("==", i) || s.startsWith("!=", i)) {
      out.push(s.slice(i, i + 2));
      i += 2;
      continue;
    }
    if (ch === "!") {
      out.push("!");
      i++;
      continue;
    }
    const start = i;
    while (
      i < s.length &&
      !/\s/.test(s.charAt(i)) &&
      !["!", "=", "(", ")"].includes(s.charAt(i))
    ) {
      if (s.startsWith("==", i) || s.startsWith("!=", i)) break;
      i++;
    }
    out.push(s.slice(start, i));
  }
  return out.filter(Boolean);
};

/**
 * Evaluate a condition expression given local and global variable scopes.
 * Supports:
 * - Truthy checks: `variable`
 * - Negation: `not variable` or `!variable`
 * - Equality: `a == b` or `a != b`
 * - Literals: true, false, null, numbers, quoted strings
 */
export const evalCond = (
  raw: string,
  locals: Record<string, any>,
  globals: Record<string, any>
): boolean => {
  const tokens = tokenizeCond(raw);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  let negate = false;
  const first = peek();
  if (first === "not" || first === "!") {
    negate = true;
    next();
  }

  const leftTok = next();
  if (!leftTok) throw new Error(`Invalid condition: ${raw}`);
  const op = peek() === "==" || peek() === "!=" ? next() : undefined;
  const rightTok = op ? next() : undefined;
  if (op && !rightTok) throw new Error(`Invalid condition: ${raw}`);

  const readValue = (tok: string): any => {
    // literal
    if (
      tok === "true" ||
      tok === "false" ||
      tok === "null" ||
      /^-?\d+(?:\.\d+)?$/.test(tok) ||
      (tok.startsWith('"') && tok.endsWith('"')) ||
      (tok.startsWith("'") && tok.endsWith("'"))
    ) {
      return parseLiteral(tok);
    }

    const path = tok.split(".").filter(Boolean);
    if (path.length === 0) return undefined;

    const head = path[0]!;

    // locals first
    if (head in locals) {
      if (path.length === 1) return locals[head];
      return getPathValue(locals[head], path.slice(1));
    }
    return getPathValue(globals, path);
  };

  const left = readValue(leftTok);
  let result: boolean;
  if (!op) {
    result = truthy(left);
  } else {
    const right = readValue(rightTok!);
    // Compare numbers if both are numbers; else compare strings
    if (typeof left === "number" && typeof right === "number") {
      result = op === "==" ? left === right : left !== right;
    } else if (typeof left === "boolean" && typeof right === "boolean") {
      result = op === "==" ? left === right : left !== right;
    } else {
      const ls = left === undefined || left === null ? "" : String(left);
      const rs = right === undefined || right === null ? "" : String(right);
      result = op === "==" ? ls === rs : ls !== rs;
    }
  }

  return negate ? !result : result;
};
