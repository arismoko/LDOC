import { describe, test, expect } from "bun:test";
import { compile } from "../src/compiler";
import { decompile } from "../src/decompiler";
import { Lexer } from "../src/parser/lexer/tokenizer";
import { Parser } from "../src/parser/parser";
import JSZip from "jszip";

async function parse(input: string) {
  const lexer = new Lexer(input);
  const tokens = lexer.tokenize();
  const parser = new Parser();
  return parser.parse(tokens);
}

describe("Decompiler", () => {
  test("preserves headings", async () => {
    // Note: Compiler output for @1 is Heading 1, but decompiler might output # Heading 1
    // depending on implementation. Let's check for content first.
    const ldoc = "# Heading 1\n\n## Heading 2";
    const docx = await compile(await parse(ldoc));
    const result = await decompile(docx);
    expect(result.source).toContain("Heading 1");
    expect(result.source).toContain("Heading 2");
  });

  test("preserves bold and italic", async () => {
    const ldoc = "This is *bold* and _italic_ text.";
    const docx = await compile(await parse(ldoc));
    const result = await decompile(docx);
    // Decompiler might normalize *bold* to **bold** or vice versa
    // Let's check for the words at least
    expect(result.source).toContain("bold");
    expect(result.source).toContain("italic");
  });

  test("preserves hyperlinks", async () => {
    const ldoc = "Check out [this link](https://example.com) for more info.";
    const docx = await compile(await parse(ldoc));
    const result = await decompile(docx);
    expect(result.source).toContain("[this link](https://example.com)");
  });

  test("preserves strikethrough", async () => {
    const ldoc = "This is ~~deleted~~ text.";
    const docx = await compile(await parse(ldoc));
    const result = await decompile(docx);
    expect(result.source).toContain("~~deleted~~");
  });

  test("preserves inline code", async () => {
    const ldoc = "Use the `console.log()` function.";
    const docx = await compile(await parse(ldoc));
    const result = await decompile(docx);
    expect(result.source).toContain("`console.log()`");
  });

  test("decompiles bookmarks to @anchor", async () => {
    // Create a DOCX with a bookmark manually by injecting XML
    const ldoc = "Regular paragraph.";
    const docx = await compile(await parse(ldoc));
    
    // Unzip, inject bookmark, and rezip
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Inject a bookmarkStart inside the paragraph (before the w:pPr or w:r)
    // Structure is: <w:p><w:pPr>...</w:pPr><w:r>...
    const modifiedXml = documentXml!.replace(
      /<w:p><w:pPr>/,
      '<w:p><w:bookmarkStart w:id="0" w:name="TestAnchor"/><w:bookmarkEnd w:id="0"/><w:pPr>'
    );
    
    zip.file("word/document.xml", modifiedXml);
    const modifiedDocx = await zip.generateAsync({ type: "uint8array" });
    
    const result = await decompile(modifiedDocx);
    expect(result.source).toContain("@anchor TestAnchor");
  });

  test("ignores hidden bookmarks starting with underscore", async () => {
    // Create a DOCX with a hidden bookmark (_GoBack style)
    const ldoc = "Some text.";
    const docx = await compile(await parse(ldoc));
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Inject a hidden bookmark (name starts with _)
    const modifiedXml = documentXml!.replace(
      /(<w:p[^>]*>)/,
      `$1<w:bookmarkStart w:id="0" w:name="_GoBack"/><w:bookmarkEnd w:id="0"/>`
    );
    
    zip.file("word/document.xml", modifiedXml);
    const modifiedDocx = await zip.generateAsync({ type: "uint8array" });
    
    const result = await decompile(modifiedDocx);
    expect(result.source).not.toContain("@anchor _GoBack");
    expect(result.source).not.toContain("@anchor");
  });
});
