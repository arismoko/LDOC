import type { DocumentNode, Node } from "../../parser/ast";
import { resolveDefinesFromImports } from "../../import/resolver";
import { clone, applyScope, hasAnchorNodes } from "./utils";
import { rewriteParams } from "./substitutor";
import { pruneControls } from "./control-flow";
import { evalCond } from "../conditions";

/**
 * Set a value at a dot-path in a target object.
 * If the path has dots, traverses and creates nested objects as needed.
 */
function setPathValue(target: Record<string, any>, path: string, value: any): void {
  const parts = path.split(".");
  if (parts.length === 1) {
    target[path] = value;
    return;
  }

  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!(key in cur) || typeof cur[key] !== "object" || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]!] = value;
}

type Def = { params: string[]; optionalParams?: Record<string, any>; template: Node[]; sourcePath?: string };

export class MacroExpander {
  private defines = new Map<string, Def>();
  private usedLabels = new Set<string>();
  private autoCounts = new Map<string, number>();
  private globals: Record<string, any>;

  constructor(globals: Record<string, any>) {
    this.globals = globals;
  }

  async expand(ast: DocumentNode): Promise<DocumentNode> {
    // 1. Load imported defines
    const imported = await resolveDefinesFromImports(ast);
    for (const [name, def] of imported.defines.entries()) {
      this.defines.set(name, {
        params: (def.node as any).params ?? [],
        optionalParams: (def.node as any).optionalParams,
        template: (def.node as any).template ?? [],
        sourcePath: def.sourcePath,
      });
    }

    // 2. Load local defines
    const bodyWithoutDefines: Node[] = [];
    for (const node of ast.body) {
      if (node.type === "define") {
        const name = (node as any).name as string;
        this.defines.set(name, {
          params: ((node as any).params ?? []) as string[],
          optionalParams: (node as any).optionalParams,
          template: ((node as any).template ?? []) as Node[],
          sourcePath: ast.sourcePath,
        });
        continue;
      }
      bodyWithoutDefines.push(node);
    }

    // 3. Expand body
    // We prune controls first on the top level, then expand
    // Actually, expandSeq handles pruneControls now.
    const expandedBody = this.expandSeq(bodyWithoutDefines.map((n) => clone(n)), [], 0, undefined, {});
    
    return { ...ast, body: expandedBody };
  }

  private expandSeq(
    nodes: Node[],
    callStack: string[] = [],
    depth = 0,
    scopePrefix?: string,
    locals: Record<string, any> = {}
  ): Node[] {
    if (depth > 50) throw new Error("@use expansion too deep (possible recursion)");
    const out: Node[] = [];

    for (const node of nodes) {
      // Handle @slot
      if ((node as any).type === "modifier" && (node as any).modifier === "slot") {
        const injected = locals["__children__"] as Node[] | undefined;
        if (injected) {
          out.push(...injected);
        }
        continue;
      }

      // Handle @set
      if ((node as any).type === "set") {
        const setNode = node as any;
        const value = evalCond(setNode.expression, locals, this.globals);
        setPathValue(locals, setNode.name, value);
        continue; // @set produces no output nodes
      }

      // Handle Control Flow
      if ((node as any).type === "if" || (node as any).type === "repeat" || (node as any).type === "foreach") {
        const keep = pruneControls([clone(node as any)], locals, this.globals, depth, scopePrefix);
        // Recursively expand the result of control flow (in case it contains @use)
        const expandedKeep = this.expandSeq(keep, callStack, depth, scopePrefix, locals);
        out.push(...expandedKeep);
        continue;
      }

      // Handle Non-Use Nodes (Recurse children)
      if ((node as any).type !== "use") {
        const cloneNode = clone(node);
        if (Array.isArray((cloneNode as any).content)) {
          (cloneNode as any).content = this.expandSeq((cloneNode as any).content, callStack, depth, scopePrefix, locals);
        }
        if (Array.isArray((cloneNode as any).children)) {
          (cloneNode as any).children = this.expandSeq((cloneNode as any).children, callStack, depth, scopePrefix, locals);
        }
        if (Array.isArray((cloneNode as any).body)) {
          (cloneNode as any).body = this.expandSeq((cloneNode as any).body, callStack, depth, scopePrefix, locals);
        }
        out.push(cloneNode);
        continue;
      }

      // Handle @use
      const useName = (node as any).name as string;
      const useArgsRaw = ((node as any).args ?? {}) as Record<string, string>;
      const useLabel = ((node as any).label ?? undefined) as string | undefined;
      const def = this.defines.get(useName);
      if (!def) throw new Error(`Unknown @use: ${useName}`);

      if (callStack.includes(useName)) {
        throw new Error(`Recursive @use detected: ${[...callStack, useName].join(" -> ")}`);
      }

      // Merge defaults
      const useArgs = { ...((def as any).optionalParams ?? {}), ...useArgsRaw };

      // Validate args - paramSet includes both required params and optional params
      const optionalParamKeys = Object.keys((def as any).optionalParams ?? {});
      const paramSet = new Set([...def.params, ...optionalParamKeys]);
      
      for (const k of Object.keys(useArgsRaw)) {
        if (!paramSet.has(k)) {
          throw new Error(`@use ${useName}: unknown param '${k}'`);
        }
      }

      const missingParams = def.params.filter((p) => !(p in useArgs));
      if (missingParams.length > 0) {
        throw new Error(`@use ${useName}: missing required param(s): ${missingParams.join(", ")}`);
      }

      // Sugar: if no label is provided, auto-generate one
      const label =
        useLabel ??
        (() => {
          const n = (this.autoCounts.get(useName) ?? 0) + 1;
          this.autoCounts.set(useName, n);
          return `${useName}_${n}`;
        })();

      const fullScope = scopePrefix ? `${scopePrefix}.${label}` : label;
      if (fullScope && this.usedLabels.has(fullScope)) {
        throw new Error(`Duplicate @use label: ${fullScope}`);
      }
      if (fullScope) this.usedLabels.add(fullScope);

      const cloned = def.template.map((n) => clone(n));
      const rewritten = paramSet.size > 0 ? cloned.map((n: any) => rewriteParams(n, paramSet, useArgs)) : cloned;
      const scoped = fullScope ? applyScope(rewritten as any, fullScope) : (rewritten as any);
      
      // Expand children (content block) in current scope
      const useChildren = (node as any).children as Node[] | undefined;
      let expandedChildren: Node[] | undefined;
      if (useChildren) {
         expandedChildren = this.expandSeq(useChildren, callStack, depth, scopePrefix, locals);
      }

      const nextLocals = { ...useArgs, __children__: expandedChildren };

      // Recurse
      const expanded = this.expandSeq(scoped as any, [...callStack, useName], depth + 1, fullScope, nextLocals);
      out.push(...expanded);
    }
    return out;
  }
}
