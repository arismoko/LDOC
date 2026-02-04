import { XMLParser } from "fast-xml-parser";

export type XmlNode = Record<string, any>;

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: false,
  processEntities: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

export function getTagKeys(obj: XmlNode): string[] {
  return Object.keys(obj).filter((k) => k !== ":@" && k !== "#text");
}

export function getOnlyKey(obj: XmlNode): string | null {
  const keys = getTagKeys(obj);
  if (keys.length !== 1) return null;
  return keys[0] ?? null;
}

export function getAttrs(nodeObj: XmlNode): Record<string, any> {
  return (nodeObj[":@"] as any) ?? {};
}

export function getChildren(nodeObj: XmlNode, tag: string): XmlNode[] {
  const arr = nodeObj[tag];
  return Array.isArray(arr) ? arr : [];
}

export function findFirst(nodes: XmlNode[] | undefined, tag: string): XmlNode | undefined {
  if (!nodes) return undefined;
  for (const n of nodes) {
    const keys = getTagKeys(n);
    for (const k of keys) {
      if (k === tag) return n;
      if (Array.isArray(n[k])) {
        const found = findFirst(n[k], tag);
        if (found) return found;
      }
    }
  }
  return undefined;
}

export function findPath(root: XmlNode[], tags: string[]): XmlNode | undefined {
  let current: XmlNode | undefined;
  let nodes: XmlNode[] | undefined = root;
  for (const tag of tags) {
    current = findFirst(nodes, tag);
    if (!current) return undefined;
    // descend via the matched tag key
    nodes = Array.isArray((current as any)[tag]) ? ((current as any)[tag] as XmlNode[]) : undefined;
  }
  return current;
}

export function attrVal(nodeObj: XmlNode | undefined, attr: string): string | undefined {
  if (!nodeObj) return undefined;
  const attrs = getAttrs(nodeObj);
  const v = attrs[attr];
  return typeof v === "string" ? v : v?.toString?.();
}
