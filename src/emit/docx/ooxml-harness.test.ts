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
    // Bookmark name is sanitized: hyphens become underscores
    expect(docXml.includes("payment_terms")).toBe(true);
  });
});
