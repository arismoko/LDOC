import { describe, expect, test } from "bun:test";

import { compileToDocument, compileToStyledDocument, parseAndBind } from "../pipeline/index.ts";
import type { Block, Paragraph } from "../types/document-ir.ts";

function paragraphText(block: Block): string {
  if (block.type !== "Paragraph") {
    return "";
  }

  return (block as Paragraph).content
    .filter((inline) => inline.type === "Text")
    .map((inline) => inline.value)
    .join("");
}

describe("layout evaluation", () => {
  test("bind allows footer region directives", () => {
    const source = `@footer{
  @center[Confidential]
}
`;

    const { diagnostics } = parseAndBind(source);
    expect(diagnostics.some((d) => d.code === "B021")).toBe(false);
  });

  test("columns directive maps to Section IR", async () => {
    const source = `@columns(count: 2, gap: "0.5in"){
  [Left]
  @break
  [Right]
}
`;

    const { document, diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    const first = document.blocks[0];
    expect(first?.type).toBe("Section");

    if (first?.type === "Section") {
      expect(first.columns?.count).toBe(2);
      expect(first.columns?.space).toBe(720);
      expect(first.content.some((block) => block.type === "ColumnBreak")).toBe(true);
    }
  });

  test("align applies text alignment to nested block content", async () => {
    const source = `@align(value: "center"){
  @box{
    [Notice]
  }
}
`;

    const { document } = await compileToDocument(source);
    const block = document.blocks[0];
    expect(block?.type).toBe("Blockquote");

    if (block?.type === "Blockquote") {
      const firstChild = block.content[0];
      expect(firstChild?.type).toBe("Paragraph");
      if (firstChild?.type === "Paragraph") {
        expect(firstChild.style?.inline?.textAlign).toBe("center");
      }
    }
  });

  test("header and footer populate metadata without leaking into body", async () => {
    const source = `@header{
  @left[Mutual NDA]
}
@footer{
  @center[Confidential]
}
[Body]
`;

    const { document } = await compileToDocument(source);

    expect(document.metadata.headers?.default?.kind).toBe("header");
    expect(document.metadata.footers?.default?.kind).toBe("footer");

    expect(document.blocks.length).toBe(1);
    expect(document.blocks[0]?.type).toBe("Paragraph");
    if (document.blocks[0]) {
      expect(paragraphText(document.blocks[0])).toBe("Body");
    }
  });

  test("@document(margins: ...) with 4-value string stores layout in metadata", async () => {
    const source = `@document(margins: "1in 1in 1in 1.25in")
[Body]
`;

    const { document, diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    const layout = document.metadata.layout;
    expect(layout).toBeDefined();
    expect(layout?.margins).toEqual({
      top: 1440,    // 1in
      right: 1440,  // 1in
      bottom: 1440, // 1in
      left: 1800,   // 1.25in
    });
  });

  test("@document(margins: ...) with 1-value string applies uniformly", async () => {
    const source = `@document(margins: "0.5in")
[Body]
`;

    const { document } = await compileToDocument(source);

    expect(document.metadata.layout?.margins).toEqual({
      top: 720,
      right: 720,
      bottom: 720,
      left: 720,
    });
  });

  test("@document(margins: ...) with 2-value string applies vertical/horizontal", async () => {
    const source = `@document(margins: "1in 0.75in")
[Body]
`;

    const { document } = await compileToDocument(source);

    expect(document.metadata.layout?.margins).toEqual({
      top: 1440,
      right: 1080,
      bottom: 1440,
      left: 1080,
    });
  });

  test("@document stores numbering mode in metadata", async () => {
    const source = `@document(numbering: { mode: "legal" })
[Body]
`;

    const { document } = await compileToDocument(source);

    expect(document.metadata.custom.numberingMode).toBe("legal");
  });

  test("@document layout flows through to styled document margins", async () => {
    const source = `@document(margins: "1in 1in 1in 1.25in")
[Body]
`;

    const { styledDocument, diagnostics } = await compileToStyledDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    expect(styledDocument.documentStyles.marginTop).toBe(1440);
    expect(styledDocument.documentStyles.marginRight).toBe(1440);
    expect(styledDocument.documentStyles.marginBottom).toBe(1440);
    expect(styledDocument.documentStyles.marginLeft).toBe(1800);
  });

  test("@anchor(id: ...) produces a Bookmark node in a wrapper paragraph", async () => {
    const source = `@anchor(id: "payment-terms")
[Body text]
`;

    const { document, diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    // First block should be the anchor paragraph
    const anchor = document.blocks[0];
    expect(anchor?.type).toBe("Paragraph");
    if (anchor?.type === "Paragraph") {
      expect(anchor.content.length).toBe(1);
      const bookmark = anchor.content[0];
      expect(bookmark?.type).toBe("Bookmark");
      if (bookmark?.type === "Bookmark") {
        expect(bookmark.name).toBe("payment-terms");
      }
    }

    // Second block should be body text
    expect(document.blocks[1]?.type).toBe("Paragraph");
  });

  test("@anchor without id produces a diagnostic", async () => {
    const source = `@anchor
[Body]
`;

    const { diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.message.includes("@anchor requires id"))).toBe(true);
  });

  test("[[id]] cross-reference produces a CrossRef IR node", async () => {
    const source = `[See [[payment-terms]] for details.]
`;

    const { document, diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    const para = document.blocks[0];
    expect(para?.type).toBe("Paragraph");
    if (para?.type === "Paragraph") {
      // Should have: Text("See "), CrossRef("payment-terms"), Text(" for details.")
      const crossRef = para.content.find((n) => n.type === "CrossRef");
      expect(crossRef).toBeDefined();
      if (crossRef?.type === "CrossRef") {
        expect(crossRef.target).toBe("payment-terms");
      }
    }
  });

  test("[[id]] alongside @anchor creates matching bookmark and cross-ref", async () => {
    const source = `@anchor(id: "sec1")
[Reference to [[sec1]] here.]
`;

    const { document } = await compileToDocument(source);

    // First block: anchor paragraph with Bookmark
    const anchorPara = document.blocks[0];
    expect(anchorPara?.type).toBe("Paragraph");
    if (anchorPara?.type === "Paragraph") {
      expect(anchorPara.content[0]?.type).toBe("Bookmark");
    }

    // Second block: paragraph with CrossRef
    const bodyPara = document.blocks[1];
    expect(bodyPara?.type).toBe("Paragraph");
    if (bodyPara?.type === "Paragraph") {
      const xref = bodyPara.content.find((n) => n.type === "CrossRef");
      expect(xref).toBeDefined();
      if (xref?.type === "CrossRef") {
        expect(xref.target).toBe("sec1");
      }
    }
  });

  test("@style(ref: ...) resolves style from @def bindings", async () => {
    const source = `@def(strong: { r: { bold: true } })
[@style(ref: "strong"){important text}]
`;

    const { document, diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);

    const para = document.blocks[0];
    expect(para?.type).toBe("Paragraph");
    if (para?.type === "Paragraph") {
      const styled = para.content.find((n) => n.type === "Styled");
      expect(styled).toBeDefined();
      if (styled?.type === "Styled") {
        expect(styled.style.bold).toBe(true);
        expect(styled.content[0]?.type).toBe("Text");
        if (styled.content[0]?.type === "Text") {
          expect(styled.content[0].value).toBe("important text");
        }
      }
    }
  });

  test("@style(ref: ...) with missing def produces diagnostic", async () => {
    const source = `[@style(ref: "nonexistent"){text}]
`;

    const { diagnostics } = await compileToDocument(source);
    expect(diagnostics.some((d) => d.message.includes("not found in @def"))).toBe(true);
  });
});
