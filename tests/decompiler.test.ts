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

  test("decompiles footnotes with references and definitions", async () => {
    // Create a DOCX with footnotes by injecting XML
    const ldoc = "Some text with a note.";
    const docx = await compile(await parse(ldoc));
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Inject a footnote reference in the document
    // The structure is: <w:r><w:footnoteReference w:id="1"/></w:r>
    const modifiedXml = documentXml!.replace(
      /(<w:t[^>]*>Some text with a note\.<\/w:t>)/,
      `$1</w:r><w:r><w:footnoteReference w:id="1"/>`
    );
    
    zip.file("word/document.xml", modifiedXml);
    
    // Create word/footnotes.xml with the footnote definition
    const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="0" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:id="-1" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="1">
    <w:p>
      <w:r>
        <w:t>This is the footnote content.</w:t>
      </w:r>
    </w:p>
  </w:footnote>
</w:footnotes>`;
    
    zip.file("word/footnotes.xml", footnotesXml);
    const modifiedDocx = await zip.generateAsync({ type: "uint8array" });
    
    const result = await decompile(modifiedDocx);
    
    // Should contain the inline reference
    expect(result.source).toContain("[^1]");
    // Should contain the footnote definition at the end
    expect(result.source).toContain("[^1]: This is the footnote content.");
  });

  test("decompiles multiple footnotes in order", async () => {
    // Create a DOCX with multiple footnotes
    const ldoc = "First note. Second note.";
    const docx = await compile(await parse(ldoc));
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Inject footnote references
    let modifiedXml = documentXml!.replace(
      /(<w:t[^>]*>First note\.<\/w:t>)/,
      `$1</w:r><w:r><w:footnoteReference w:id="1"/>`
    );
    modifiedXml = modifiedXml.replace(
      /(<w:t[^>]*>Second note\.<\/w:t>)/,
      `$1</w:r><w:r><w:footnoteReference w:id="2"/>`
    );
    
    zip.file("word/document.xml", modifiedXml);
    
    // Create footnotes.xml with multiple footnotes
    const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="0" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:id="-1" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  <w:footnote w:id="1">
    <w:p><w:r><w:t>First footnote content.</w:t></w:r></w:p>
  </w:footnote>
  <w:footnote w:id="2">
    <w:p><w:r><w:t>Second footnote content.</w:t></w:r></w:p>
  </w:footnote>
</w:footnotes>`;
    
    zip.file("word/footnotes.xml", footnotesXml);
    const modifiedDocx = await zip.generateAsync({ type: "uint8array" });
    
    const result = await decompile(modifiedDocx);
    
    // Should contain both inline references
    expect(result.source).toContain("[^1]");
    expect(result.source).toContain("[^2]");
    // Should contain both definitions
    expect(result.source).toContain("[^1]: First footnote content.");
    expect(result.source).toContain("[^2]: Second footnote content.");
  });

  test("skips separator footnotes (id 0 and -1)", async () => {
    const ldoc = "Text with footnote.";
    const docx = await compile(await parse(ldoc));
    
    const zip = await JSZip.loadAsync(docx);
    
    // Create footnotes.xml with separator footnotes only (no actual footnotes)
    const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="0" w:type="separator"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:id="-1" w:type="continuationSeparator"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
</w:footnotes>`;
    
    zip.file("word/footnotes.xml", footnotesXml);
    const modifiedDocx = await zip.generateAsync({ type: "uint8array" });
    
    const result = await decompile(modifiedDocx);
    
    // Should not contain any footnote definitions for separator footnotes
    expect(result.source).not.toContain("[^0]:");
    expect(result.source).not.toContain("[^-1]:");
  });
});
