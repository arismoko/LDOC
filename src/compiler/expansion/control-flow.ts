import { evalCond, getPathValue } from "../conditions";
import { clone, applyScope } from "./utils";
import { applyFilters } from "./substitutor";

export const pruneControls = (
  nodes: any[],
  locals: Record<string, any>,
  globals: Record<string, any>,
  depth: number,
  scopePrefix?: string
): any[] => {
  const out: any[] = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "if") {
      const cond = String(n.condition ?? "");
      const ok = evalCond(cond, locals, globals);
      const branch = ok ? (n.thenBranch ?? []) : (n.elseBranch ?? []);
      out.push(...pruneControls(branch, locals, globals, depth + 1, scopePrefix));
      continue;
    }

    if (n.type === "repeat") {
      const count = Number(n.count ?? 0);
      if (!Number.isFinite(count) || count < 0 || Math.floor(count) !== count) {
        throw new Error(`Invalid @repeat count: ${n.count}`);
      }
      if (count > 100) {
        throw new Error(`@repeat count exceeds maximum (100): ${count}`);
      }
      const body = (n.body ?? []) as any[];
      for (let i = 0; i < count; i++) {
        const cloned = body.map((x) => clone(x));
        const iterScope = scopePrefix ? `${scopePrefix}.r${i + 1}` : `r${i + 1}`;
        const scoped = applyScope(cloned, iterScope);
        out.push(...pruneControls(scoped, locals, globals, depth + 1, iterScope));
      }
      continue;
    }

    if (n.type === "foreach") {
      const item = String(n.item ?? "").trim();
      const iterableExpr = String(n.iterable ?? "").trim();
      if (!item || !iterableExpr) {
        throw new Error("Invalid @foreach");
      }

      const resolveValue = (expr: string): any => {
        const parts = expr.split(".").filter(Boolean);
        if (parts.length === 0) return undefined;
        const root = parts[0]!;

        const rootVal = root in locals ? locals[root] : getPathValue(globals, [root]);
        if (parts.length === 1) return rootVal;
        return getPathValue(rootVal, parts.slice(1));
      };

      const rawVal = resolveValue(iterableExpr);
      if (rawVal === undefined || rawVal === null) {
        throw new Error(`@foreach iterable not found: ${iterableExpr}`);
      }

      let items: any[];
      if (Array.isArray(rawVal)) {
        items = rawVal;
      } else if (typeof rawVal === "string") {
        const s = rawVal.trim();
        if (!s) items = [];
        else if (s.includes(",")) items = s.split(",").map((x) => x.trim()).filter(Boolean);
        else items = [s];
      } else if (typeof rawVal === "object") {
        items = Object.keys(rawVal);
      } else {
        throw new Error(`@foreach iterable must be array, object, or string. Got: ${typeof rawVal}`);
      }

      if (items.length > 100) {
        throw new Error(`@foreach length exceeds maximum (100): ${items.length}`);
      }

      const body = (n.body ?? []) as any[];

      const substituteLocalsInInline = (inline: any[], env: Record<string, any>): any[] => {
        const resolveLocalPath = (v: any, path: string[]): any => {
          let cur = v;
          for (const key of path) {
            if (cur && typeof cur === "object" && key in cur) cur = cur[key];
            else return undefined;
          }
          return cur;
        };

        return inline.map((node) => {
          if (!node || typeof node !== "object") return node;

          if (node.type === "variable" && Array.isArray(node.path) && node.path.length > 0) {
            const root = node.path[0];
            if (root in env) {
              const val = node.path.length === 1 ? env[root] : resolveLocalPath(env[root], node.path.slice(1));
              if (val !== undefined) {
                const text = applyFilters(String(val), node.filters ?? []);
                return { type: "text", line: node.line, column: node.column, value: text };
              }
            }
          }

          if (node.type === "emphasis" && Array.isArray(node.content)) {
            return { ...node, content: substituteLocalsInInline(node.content, env) };
          }

          return node;
        });
      };

      const substituteLocalsInNode = (node: any, env: Record<string, any>): any => {
        if (!node || typeof node !== "object") return node;

        if (node.type === "paragraph" || node.type === "header") {
          return { ...node, content: substituteLocalsInInline(node.content ?? [], env) };
        }
        if (node.type === "numbered_item" || node.type === "bullet_item") {
          return {
            ...node,
            content: substituteLocalsInInline(node.content ?? [], env),
            children: (node.children ?? []).map((c: any) => substituteLocalsInNode(c, env)),
          };
        }
        if (node.type === "modifier") {
          return { ...node, content: (node.content ?? []).map((c: any) => substituteLocalsInNode(c, env)) };
        }
        if (node.type === "table") {
          return {
            ...node,
            rows: (node.rows ?? []).map((r: any) => ({
              ...r,
              cells: (r.cells ?? []).map((cell: any[]) => substituteLocalsInInline(cell ?? [], env)),
            })),
          };
        }
        if (node.type === "doc_header" || node.type === "doc_footer") {
          return { ...node, content: (node.content ?? []).map((c: any) => substituteLocalsInNode(c, env)) };
        }
        return node;
      };

      for (let i = 0; i < items.length; i++) {
        const env = { ...locals, [item]: items[i], index: i + 1, [`${item}_index`]: i + 1 };

        const cloned = body.map((x) => clone(x));
        const rewritten = cloned.map((x) => substituteLocalsInNode(x, env));
        const iterScope = scopePrefix ? `${scopePrefix}.for${item}${i + 1}` : `for${item}${i + 1}`;
        const scoped = applyScope(rewritten, iterScope);
        out.push(...pruneControls(scoped, env, globals, depth + 1, iterScope));
      }
      continue;
    }

    // Recurse into blocks that can contain nodes
    if (Array.isArray(n.content)) {
      n.content = pruneControls(n.content, locals, globals, depth + 1, scopePrefix);
    }
    if (Array.isArray(n.children)) {
      n.children = pruneControls(n.children, locals, globals, depth + 1, scopePrefix);
    }
    if (Array.isArray(n.body)) {
      n.body = pruneControls(n.body, locals, globals, depth + 1, scopePrefix);
    }
    if (Array.isArray(n.rows)) {
      // tables: rows are objects with cells inline; they won't contain IfNodes in rows array in our AST
    }

    out.push(n);
  }
  return out;
};
