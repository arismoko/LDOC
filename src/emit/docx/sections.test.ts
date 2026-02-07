import { describe, expect, test } from "bun:test";

import { compileToOoxml } from "./test-utils.ts";

describe("docx section emission", () => {
  test("emits column section properties for Section IR", async () => {
    const source = `[Prelude]
@columns(count: 2, gap: "0.5in"){
  [Left]
  @break
  [Right]
}
[After]
`;

    const pkg = await compileToOoxml(source);
    const xml = await pkg.readPart("word/document.xml");

    expect(xml.includes("<w:cols")).toBe(true);
    expect(xml.includes('w:num="2"')).toBe(true);
  });

  test("attaches metadata header/footer to first section", async () => {
    const source = `@header{ @left[Top Header] }
@footer{ @center[Bottom Footer] }
[Body]
`;

    const pkg = await compileToOoxml(source);
    const docXml = await pkg.readPart("word/document.xml");

    expect(pkg.hasPart("word/header1.xml")).toBe(true);
    expect(pkg.hasPart("word/footer1.xml")).toBe(true);
    expect(docXml.includes("<w:headerReference")).toBe(true);
    expect(docXml.includes("<w:footerReference")).toBe(true);
  });
});
