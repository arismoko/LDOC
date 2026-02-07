import { describe, expect, test } from "bun:test";

import { compileToOoxml } from "./test-utils.ts";

describe("ooxml harness", () => {
  test("exposes document, numbering, and styles parts", async () => {
    const source = `@style(ref: "Heading1")[Title]
@#[Item one]
@#[Item two]
`;

    const pkg = await compileToOoxml(source);

    expect(pkg.hasPart("word/document.xml")).toBe(true);
    expect(pkg.hasPart("word/numbering.xml")).toBe(true);
    expect(pkg.hasPart("word/styles.xml")).toBe(true);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    const stylesXml = await pkg.readPart("word/styles.xml");

    expect(numberingXml.includes("<w:numbering")).toBe(true);
    expect(numberingXml.includes("w:numFmt")).toBe(true);
    expect(stylesXml.includes("<w:styles")).toBe(true);
    expect(stylesXml.includes('w:styleId="Heading1"')).toBe(true);
  });

  test("@anchor emits bookmarkStart and bookmarkEnd in DOCX XML", async () => {
    const source = `@anchor(id: "payment-terms")
[See payment terms above.]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    expect(docXml.includes("w:bookmarkStart")).toBe(true);
    expect(docXml.includes("w:bookmarkEnd")).toBe(true);
    // Bookmark name is sanitized: hyphens become underscores, lowercased
    expect(docXml.includes("payment_terms")).toBe(true);
  });

  test("forward cross-reference resolves without warning", async () => {
    const source = `[See @ref(id: "sec1") for details.]
@anchor(id: "sec1")
`;

    const pkg = await compileToOoxml(source);
    // No "target not found" warning — pre-pass collects anchors before emission
    const targetWarnings = pkg.diagnostics.filter(
      (d) => d.code === "E003" && d.message.includes("sec1")
    );
    expect(targetWarnings.length).toBe(0);

    const docXml = await pkg.readPart("word/document.xml");
    // Should have both the hyperlink and the bookmark
    expect(docXml.includes("w:bookmarkStart")).toBe(true);
    expect(docXml.includes("w:hyperlink")).toBe(true);
  });

  test("@#(start: 5) emits numbering with custom start value", async () => {
    const source = `@#(start: 5)[Fifth item]
@#[Sixth item]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const numberingXml = await pkg.readPart("word/numbering.xml");
    // Should contain a numbering level with start value of 5
    expect(numberingXml.includes("<w:start w:val=\"5\"/>")).toBe(true);
  });

  test("@#(continue: true) reuses same numbering instance as previous list", async () => {
    const source = `@#[First item]
@#[Second item]

[Interrupting paragraph.]

@#(continue: true)[Third item]
@#[Fourth item]
`;

    const pkg = await compileToOoxml(source);
    expect(pkg.diagnostics.some((d) => d.severity === "error")).toBe(false);

    const docXml = await pkg.readPart("word/document.xml");
    // Both list runs should reference numbering — the continued list
    // should share the same w:numId as the first list
    const numIdMatches = docXml.match(/w:numId w:val="(\d+)"/g) ?? [];
    // With continue, we expect at least 2 groups sharing the same numId
    expect(numIdMatches.length).toBeGreaterThanOrEqual(3);

    // Extract actual numId values
    const numIds = numIdMatches.map((m) => m.match(/w:val="(\d+)"/)?.[1]);
    // The continued items should reuse the same numId as the first list
    const firstListId = numIds[0];
    const continuedId = numIds[numIds.length - 1];
    expect(continuedId).toBe(firstListId);
  });
});
