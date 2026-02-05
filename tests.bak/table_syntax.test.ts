import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser/parser";
import { compile } from "../src/compiler";
import { decompile } from "../src/decompiler";
import { Lexer } from "../src/parser/lexer";
import { TokenType } from "../src/parser/lexer/patterns";
import JSZip from "jszip";

describe("Table Syntax", () => {
  test("Lexer tokenizes @row and @cell", () => {
    const input = `@table
  @row
    @cell: Content
    @cell(colspan: 2)
      Block content`;
      
    const lexer = new Lexer(input);
    const tokens = lexer.tokenize();
    
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.TABLE);
    expect(types).toContain(TokenType.ROW);
    expect(types).toContain(TokenType.CELL);
    
    // Check that CELL token has raw value with args
    const cellTokens = tokens.filter(t => t.type === TokenType.CELL);
    expect(cellTokens.length).toBe(2);
  });

  test("Parser parses shorthand syntax", () => {
    const input = `@table
  @row
    @cell: Cell 1
    @cell: Cell 2`;
    
    const ast = parse(input);
    const table = ast.body[0] as any;
    expect(table.type).toBe("table");
    expect(table.rows.length).toBe(1);
    expect(table.rows[0].cells.length).toBe(2);
    
    const cell1 = table.rows[0].cells[0];
    // Content is ParagraphNode -> InlineNode[]
    expect(cell1.content[0].type).toBe("paragraph");
    expect(cell1.content[0].content[0].value).toBe("Cell 1");
  });

  test("Parser parses block syntax", () => {
    const input = `@table
  @row
    @cell
      Line 1
      
      Line 2`;
      
    const ast = parse(input);
    const table = ast.body[0] as any;
    const cell = table.rows[0].cells[0];
    
    expect(cell.content.length).toBe(2); // 2 paragraphs
    expect(cell.content[0].content[0].value).toBe("Line 1");
    expect(cell.content[1].content[0].value).toBe("Line 2");
  });

  test("Parser parses attributes", () => {
    const input = `@table
  @row
    @cell(colspan: 2, rowspan: 3): Merged`;
    
    const ast = parse(input);
    const cell = (ast.body[0] as any).rows[0].cells[0];
    
    expect(cell.colspan).toBe(2);
    expect(cell.rowspan).toBe(3);
  });
});

describe("Table Phase 1 - Row Height", () => {
  test("Parser parses row height and heightRule attributes", () => {
    const input = `@table
  @row(height: 0.5in, heightRule: exact)
    @cell: Fixed height`;
    
    const ast = parse(input);
    const row = (ast.body[0] as any).rows[0];
    
    expect(row.attributes?.height).toBe("0.5in");
    expect(row.attributes?.heightRule).toBe("exact");
  });

  test("Compiler emits w:trHeight for row height", async () => {
    const input = `@table
  @row(height: 720twip, heightRule: exact)
    @cell: Row with height`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    // Unzip and check document.xml
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Check for w:trHeight with correct value and rule
    expect(documentXml).toContain("w:trHeight");
    expect(documentXml).toContain('w:val="720"');
    expect(documentXml).toContain('w:hRule="exact"');
  });

  test("Compiler emits w:trHeight with atLeast rule", async () => {
    const input = `@table
  @row(height: 1in, heightRule: atLeast)
    @cell: Minimum height`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    expect(documentXml).toContain("w:trHeight");
    // 1in = 1440 twips
    expect(documentXml).toContain('w:val="1440"');
    expect(documentXml).toContain('w:hRule="atLeast"');
  });

  test("Decompiler extracts row height as v2 args", async () => {
    const input = `@table
  @row(height: 720twip, heightRule: exact)
    @cell: Test`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    const result = await decompile(docx);
    
    expect(result.source).toContain("@row(");
    expect(result.source).toContain("height:");
    expect(result.source).toContain("heightRule: exact");
  });
});

describe("Table Phase 1 - Cell Padding", () => {
  test("Parser parses cell padding attribute (single value)", () => {
    const input = `@table
  @row
    @cell(padding: 0.1in): Padded`;
    
    const ast = parse(input);
    const cell = (ast.body[0] as any).rows[0].cells[0];
    
    expect(cell.attributes?.padding).toBe("0.1in");
  });

  test("Parser parses cell padding attribute (list)", () => {
    const input = `@table
  @row
    @cell(padding: [6pt, 12pt]): Padded`;
    
    const ast = parse(input);
    const cell = (ast.body[0] as any).rows[0].cells[0];
    
    expect(cell.attributes?.padding).toBe("[6pt, 12pt]");
  });

  test("Compiler emits w:tcMar for cell padding", async () => {
    const input = `@table
  @row
    @cell(padding: 200twip): Padded cell`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Check for w:tcMar with top/right/bottom/left
    expect(documentXml).toContain("w:tcMar");
    expect(documentXml).toContain("<w:top");
    expect(documentXml).toContain('w:w="200"');
  });

  test("Decompiler extracts cell padding as v2 args", async () => {
    const input = `@table
  @row
    @cell(padding: 200twip): Test`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    const result = await decompile(docx);
    
    expect(result.source).toContain("@cell(padding:");
  });
});

describe("Table Phase 1 - Cell Background", () => {
  test("Parser parses cell background attribute", () => {
    const input = `@table
  @row
    @cell(background: "#FF0000"): Red`;
    
    const ast = parse(input);
    const cell = (ast.body[0] as any).rows[0].cells[0];
    
    expect(cell.attributes?.background).toBe("#FF0000");
  });

  test("Compiler emits w:shd fill for cell background", async () => {
    const input = `@table
  @row
    @cell(background: "#AABBCC"): Colored cell`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Check for w:shd with fill
    expect(documentXml).toContain("w:shd");
    expect(documentXml).toContain('w:fill="AABBCC"');
  });

  test("Cell background overrides header default shading", async () => {
    const input = `@table
  @row(header)
    @cell(background: "#FF0000"): Custom header`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Check that custom color is used
    expect(documentXml).toContain('w:fill="FF0000"');
  });

  test("Decompiler extracts cell background as v2 args", async () => {
    const input = `@table
  @row
    @cell(background: "#AABBCC"): Test`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    const result = await decompile(docx);
    
    expect(result.source).toContain('background: "#AABBCC"');
  });
});

describe("Table Phase 1 - Table Default Padding", () => {
  test("Parser parses table padding attribute", () => {
    const input = `@table(padding: 0.15in)
  @row
    @cell: Content`;
    
    const ast = parse(input);
    const table = ast.body[0] as any;
    
    expect(table.attributes?.padding).toBe("0.15in");
  });

  test("Table padding applies as default cell margins", async () => {
    const input = `@table(padding: 300twip)
  @row
    @cell: Content`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Table margins should be 300
    expect(documentXml).toContain("w:tblCellMar");
    expect(documentXml).toContain('w:w="300"');
  });

  test("Cell padding overrides table default", async () => {
    const input = `@table(padding: 100twip)
  @row
    @cell(padding: 400twip): Custom padding`;
    
    const ast = parse(input);
    const docx = await compile(ast);
    
    const zip = await JSZip.loadAsync(docx);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toBeDefined();
    
    // Cell should have its own w:tcMar with 400
    expect(documentXml).toContain("w:tcMar");
    expect(documentXml).toContain('w:w="400"');
  });
});
