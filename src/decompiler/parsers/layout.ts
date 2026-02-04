import { xmlParser, findFirst, attrVal, getOnlyKey, type XmlNode } from "../xml";

export type SectionProps = {
  cols?: number;
  colSpace?: number; // twips
  colSep?: boolean;
  sectionType?: string; // "continuous", "nextPage", etc.
};

export type LayoutInfo = {
  margins?: { top: number; right: number; bottom: number; left: number };
  landscape?: boolean;
  spacing?: { lineMultiplier?: number };
};

export type HeaderFooterRefs = {
  defaultHeader?: string;
  defaultFooter?: string;
  firstHeader?: string;
  firstFooter?: string;
};

export function parseSectionProps(sectPrNode: XmlNode): SectionProps {
  const props: SectionProps = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:cols") {
      const num = attrVal(child, "@_w:num");
      if (num) {
        props.cols = parseInt(num, 10);
      }
      const space = attrVal(child, "@_w:space");
      if (space) {
        props.colSpace = parseInt(space, 10);
      }
      const sep = attrVal(child, "@_w:sep");
      if (sep === "true" || sep === "1") {
        props.colSep = true;
      }
    }
    if (key === "w:type") {
      props.sectionType = attrVal(child, "@_w:val");
    }
  }

  return props;
}

export function parseLayoutFromSectPr(sectPrNode: XmlNode): LayoutInfo {
  const layout: LayoutInfo = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:pgMar") {
      const top = attrVal(child, "@_w:top");
      const right = attrVal(child, "@_w:right");
      const bottom = attrVal(child, "@_w:bottom");
      const left = attrVal(child, "@_w:left");
      if (top && right && bottom && left) {
        layout.margins = {
          top: parseInt(top, 10),
          right: parseInt(right, 10),
          bottom: parseInt(bottom, 10),
          left: parseInt(left, 10),
        };
      }
    }
    if (key === "w:pgSz") {
      const orient = attrVal(child, "@_w:orient");
      if (orient === "landscape") {
        layout.landscape = true;
      }
    }
  }

  return layout;
}

export function parseHeaderFooterRefs(sectPrNode: XmlNode): HeaderFooterRefs {
  const refs: HeaderFooterRefs = {};
  const sectPrChildren = sectPrNode["w:sectPr"] as XmlNode[];

  for (const child of sectPrChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:headerReference") {
      const type = attrVal(child, "@_w:type");
      const rId = attrVal(child, "@_r:id");
      if (type === "default" && rId) {
        refs.defaultHeader = rId;
      } else if (type === "first" && rId) {
        refs.firstHeader = rId;
      }
    }
    if (key === "w:footerReference") {
      const type = attrVal(child, "@_w:type");
      const rId = attrVal(child, "@_r:id");
      if (type === "default" && rId) {
        refs.defaultFooter = rId;
      } else if (type === "first" && rId) {
        refs.firstFooter = rId;
      }
    }
  }

  return refs;
}

export function parseDocumentRels(relsXml: string): Map<string, string> {
  const relMap = new Map<string, string>();
  const tree = xmlParser.parse(relsXml) as XmlNode[];

  const relationships = findFirst(tree, "Relationships");
  if (!relationships) return relMap;

  const relChildren = relationships["Relationships"] as XmlNode[];
  for (const child of relChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "Relationship") {
      const rId = attrVal(child, "@_Id");
      const target = attrVal(child, "@_Target");
      if (rId && target) {
        relMap.set(rId, target);
      }
    }
  }

  return relMap;
}

export function findFinalSectPr(bodyChildren: XmlNode[]): XmlNode | undefined {
  // The final sectPr is a direct child of w:body
  for (const child of bodyChildren ?? []) {
    const key = getOnlyKey(child);
    if (key === "w:sectPr") {
      return child;
    }
  }
  return undefined;
}

export function findParagraphSectPr(pNode: XmlNode): XmlNode | undefined {
  const pChildren = pNode["w:p"] as XmlNode[];
  const pPr = findFirst(pChildren, "w:pPr");
  if (!pPr) return undefined;
  const pPrChildren = pPr["w:pPr"] as XmlNode[];
  return findFirst(pPrChildren, "w:sectPr");
}
