import { findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";

/**
 * Extract image reference from a w:drawing or w:pict element.
 * Returns the relative target path (e.g., "media/image1.png") or undefined.
 */
export function extractImageFromDrawing(drawingNode: XmlNode, rels: Map<string, string>): string | undefined {
  // Modern Word uses w:drawing > wp:inline > a:graphic > a:graphicData > pic:pic > pic:blipFill > a:blip
  // or w:drawing > wp:anchor > ...
  const drawingChildren = drawingNode["w:drawing"] as XmlNode[];
  if (!drawingChildren) return undefined;

  // Look for a:blip anywhere in the tree
  const blip = findBlipRecursive(drawingChildren);
  if (!blip) return undefined;

  // Get r:embed attribute
  const rId = attrVal(blip, "@_r:embed");
  if (!rId) return undefined;

  // Look up in rels
  const target = rels.get(rId);
  if (!target) return undefined;

  // Target is relative to word/ directory, e.g., "media/image1.png"
  // Return as "media/image1.png" for the LDOC output
  return target;
}

/**
 * Extract image from legacy w:pict element (VML).
 */
export function extractImageFromPict(pictNode: XmlNode, rels: Map<string, string>): string | undefined {
  // Legacy format: w:pict > v:shape > v:imagedata
  const pictChildren = pictNode["w:pict"] as XmlNode[];
  if (!pictChildren) return undefined;

  // Look for v:imagedata anywhere
  const imagedata = findNodeRecursive(pictChildren, "v:imagedata");
  if (!imagedata) return undefined;

  // Get r:id attribute
  const rId = attrVal(imagedata, "@_r:id");
  if (!rId) return undefined;

  const target = rels.get(rId);
  if (!target) return undefined;

  return target;
}

/**
 * Try to extract alt text from drawing element.
 * Looks in wp:docPr for name or descr attributes.
 */
export function extractAltText(drawingNode: XmlNode): string {
  const drawingChildren = drawingNode["w:drawing"] as XmlNode[];
  if (!drawingChildren) return "image";

  const docPr = findNodeRecursive(drawingChildren, "wp:docPr");
  if (docPr) {
    const descr = attrVal(docPr, "@_descr");
    if (descr && descr.trim()) return descr.trim();
    const name = attrVal(docPr, "@_name");
    if (name && name.trim()) return name.trim();
  }

  return "image";
}

function findBlipRecursive(nodes: XmlNode[]): XmlNode | undefined {
  for (const node of nodes) {
    const key = getOnlyKey(node);
    if (!key) continue;
    if (key === "a:blip") return node;
    const children = node[key];
    if (Array.isArray(children)) {
      const found = findBlipRecursive(children as XmlNode[]);
      if (found) return found;
    }
  }
  return undefined;
}

function findNodeRecursive(nodes: XmlNode[], targetTag: string): XmlNode | undefined {
  for (const node of nodes) {
    const key = getOnlyKey(node);
    if (!key) continue;
    if (key === targetTag) return node;
    const children = node[key];
    if (Array.isArray(children)) {
      const found = findNodeRecursive(children as XmlNode[], targetTag);
      if (found) return found;
    }
  }
  return undefined;
}
