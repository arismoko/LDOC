export const applyFilters = (value: string, filters: string[]): string => {
  let result = String(value);
  for (const filter of filters) {
    switch (filter) {
      case "upper":
        result = result.toUpperCase();
        break;
      case "lower":
        result = result.toLowerCase();
        break;
      case "capitalize":
        result = result.charAt(0).toUpperCase() + result.slice(1);
        break;
    }
  }
  return result;
};

export const substituteParamsInInline = (nodes: any[], params: Set<string>, args: Record<string, string>): any[] => {
  return nodes.map((n) => {
    if (n.type === "variable" && Array.isArray(n.path) && n.path.length === 1) {
      const key = n.path[0];
      if (params.has(key)) {
        if (!(key in args)) {
          // leave as-is; unresolved variable validation will catch it
          return n;
        }
        return {
          type: "text",
          line: n.line,
          column: n.column,
          value: applyFilters(String(args[key]), n.filters ?? []),
        };
      }
    }
    if (n.type === "emphasis" && Array.isArray(n.content)) {
      return { ...n, content: substituteParamsInInline(n.content, params, args) };
    }
    return n;
  });
};

export const rewriteParams = (node: any, params: Set<string>, args: Record<string, string>): any => {
  if (!node || typeof node !== "object") return node;
  if (node.type === "paragraph") {
    return { ...node, content: substituteParamsInInline(node.content ?? [], params, args) };
  }
  if (node.type === "header") {
    return { ...node, content: substituteParamsInInline(node.content ?? [], params, args) };
  }
  if (node.type === "numbered_item" || node.type === "bullet_item") {
    return {
      ...node,
      content: substituteParamsInInline(node.content ?? [], params, args),
      children: (node.children ?? []).map((c: any) => rewriteParams(c, params, args)),
    };
  }
  if (node.type === "modifier") {
    return { ...node, content: (node.content ?? []).map((c: any) => rewriteParams(c, params, args)) };
  }
  if (node.type === "table") {
    return {
      ...node,
      rows: (node.rows ?? []).map((r: any) => ({
        ...r,
        cells: (r.cells ?? []).map((cell: any[]) => substituteParamsInInline(cell ?? [], params, args)),
      })),
    };
  }
  if (node.type === "doc_header" || node.type === "doc_footer") {
    return { ...node, content: (node.content ?? []).map((c: any) => rewriteParams(c, params, args)) };
  }
  return node;
};
