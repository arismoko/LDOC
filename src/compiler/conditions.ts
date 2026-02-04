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
 */
export const tokenizeCond = (raw: string): string[] => {
  const s = raw.trim();
  const out: string[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s.charAt(i);

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let buf = quote;
      i++;
      while (i < s.length) {
        const c = s.charAt(i);
        if (c === "\\") {
          if (i + 1 >= s.length) break;
          buf += c + s.charAt(i + 1);
          i += 2;
          continue;
        }
        buf += c;
        i++;
        if (c === quote) break;
      }
      out.push(buf);
      continue;
    }

    // Multi-char operators
    if (s.startsWith("==", i)) { out.push("=="); i += 2; continue; }
    if (s.startsWith("!=", i)) { out.push("!="); i += 2; continue; }
    if (s.startsWith("<=", i)) { out.push("<="); i += 2; continue; }
    if (s.startsWith(">=", i)) { out.push(">="); i += 2; continue; }
    if (s.startsWith("&&", i)) { out.push("&&"); i += 2; continue; }
    if (s.startsWith("||", i)) { out.push("||"); i += 2; continue; }

    // Single-char operators/punctuation
    if (["(", ")", "!", "<", ">", "+", "-", "*", "/"].includes(ch)) {
      out.push(ch);
      i++;
      continue;
    }

    // Identifiers / Numbers
    // Consume until we hit a special char or whitespace
    const start = i;
    while (
      i < s.length &&
      !/\s/.test(s.charAt(i)) &&
      !["(", ")", "!", "<", ">", "+", "-", "*", "/", "=", "&", "|"].includes(s.charAt(i))
    ) {
      i++;
    }
    
    // If we didn't advance, it's an unknown char (like a single & or | without pair), consume it to avoid loop
    if (i === start) {
      out.push(s.charAt(i));
      i++;
    } else {
      out.push(s.slice(start, i));
    }
  }
  return out;
};

/**
 * Evaluate a condition expression given local and global variable scopes.
 * Implements a recursive descent parser for:
 * - Logical OR (||)
 * - Logical AND (&&)
 * - Equality (==, !=)
 * - Relational (<, <=, >, >=)
 * - Additive (+, -)
 * - Multiplicative (*, /)
 * - Unary (!, -)
 * - Primary (literals, variables, parens)
 */
export const evalCond = (
  raw: string,
  locals: Record<string, any>,
  globals: Record<string, any>
): any => {
  const tokens = tokenizeCond(raw);
  let pos = 0;

  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  const match = (op: string) => {
    if (peek() === op) {
      pos++;
      return true;
    }
    return false;
  };

  const readValue = (tok: string): any => {
    // Quoted string
    if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
      return tok.slice(1, -1);
    }
    // Number literal
    if (/^-?\d+(?:\.\d+)?$/.test(tok)) {
      return Number(tok);
    }
    // Boolean/Null literals
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (tok === "null") return null;

    // Variable path
    const path = tok.split(".").filter(Boolean);
    if (path.length === 0) return undefined;

    const head = path[0]!;
    if (head in locals) {
      if (path.length === 1) return locals[head];
      return getPathValue(locals[head], path.slice(1));
    }
    return getPathValue(globals, path);
  };

  const parsePrimary = (): any => {
    const tok = consume();
    if (!tok) throw new Error("Unexpected end of expression");

    if (tok === "(") {
      const val = parseExpression();
      if (!match(")")) throw new Error("Expected ')'");
      return val;
    }

    return readValue(tok);
  };

  const parseUnary = (): any => {
    if (match("!")) {
      return !truthy(parseUnary());
    }
    if (match("-")) {
      const val = parseUnary();
      return -Number(val);
    }
    return parsePrimary();
  };

  const parseMultiplicative = (): any => {
    let left = parseUnary();
    while (true) {
      if (match("*")) {
        left = Number(left) * Number(parseUnary());
      } else if (match("/")) {
        left = Number(left) / Number(parseUnary());
      } else {
        break;
      }
    }
    return left;
  };

  const parseAdditive = (): any => {
    let left = parseMultiplicative();
    while (true) {
      if (match("+")) {
        const right = parseMultiplicative();
        // If either is string, concat
        if (typeof left === "string" || typeof right === "string") {
          left = String(left) + String(right);
        } else {
          left = Number(left) + Number(right);
        }
      } else if (match("-")) {
        left = Number(left) - Number(parseMultiplicative());
      } else {
        break;
      }
    }
    return left;
  };

  const parseRelational = (): any => {
    let left = parseAdditive();
    while (true) {
      if (match("<")) {
        left = left < parseAdditive();
      } else if (match("<=")) {
        left = left <= parseAdditive();
      } else if (match(">")) {
        left = left > parseAdditive();
      } else if (match(">=")) {
        left = left >= parseAdditive();
      } else {
        break;
      }
    }
    return left;
  };

  const parseEquality = (): any => {
    let left = parseRelational();
    while (true) {
      if (match("==")) {
        left = left == parseRelational();
      } else if (match("!=")) {
        left = left != parseRelational();
      } else {
        break;
      }
    }
    return left;
  };

  const parseAnd = (): any => {
    let left = parseEquality();
    while (match("&&")) {
      const right = parseEquality();
      left = truthy(left) && truthy(right);
    }
    return left;
  };

  const parseExpression = (): any => {
    let left = parseAnd();
    while (match("||")) {
      const right = parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  };

  const result = parseExpression();
  if (pos < tokens.length) {
    // console.warn(`Expression has unconsumed tokens: ${tokens.slice(pos).join(" ")}`);
  }
  return result;
};
