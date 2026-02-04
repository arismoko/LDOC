import type { Node } from "../../parser/ast";

export const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

export const applyScope = (nodes: any[], scope: string): any[] => {
  const visit = (n: any): any => {
    if (!n || typeof n !== "object") return n;
    n.scope = scope;
    if (Array.isArray(n.content)) n.content = n.content.map(visit);
    if (Array.isArray(n.children)) n.children = n.children.map(visit);
    if (Array.isArray(n.body)) n.body = n.body.map(visit);
    if (Array.isArray(n.rows)) n.rows = n.rows.map(visit);
    if (n.type === "table_row" && Array.isArray(n.cells)) {
      n.cells = n.cells.map((cell: any) => {
        cell.scope = scope;
        if (Array.isArray(cell.content)) {
          cell.content = cell.content.map(visit);
        }
        return cell;
      });
    }
    return n;
  };
  return nodes.map(visit);
};

export const hasAnchorNodes = (nodes: Node[]): boolean => {
  const stack: any[] = [...nodes];
  while (stack.length) {
    const n: any = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (n.type === "anchor") return true;
    if (Array.isArray(n.content)) stack.push(...n.content);
    if (Array.isArray(n.children)) stack.push(...n.children);
    if (Array.isArray(n.body)) stack.push(...n.body);
    if (Array.isArray(n.rows)) stack.push(...n.rows);
  }
  return false;
};
