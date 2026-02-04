import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser/parser";
import { Lexer } from "../src/parser/lexer";
import { TokenType } from "../src/parser/lexer/patterns";

describe("Table Syntax", () => {
  test("Lexer tokenizes @row and @cell", () => {
    const input = `@table
  @row
    @cell: Content
    @cell colspan=2
      Block content`;
      
    const lexer = new Lexer(input);
    const tokens = lexer.tokenize();
    
    const types = tokens.map(t => t.type);
    expect(types).toContain(TokenType.TABLE);
    expect(types).toContain(TokenType.ROW);
    expect(types).toContain(TokenType.CELL);
    
    const cellTokens = tokens.filter(t => t.type === TokenType.CELL);
    expect(cellTokens[1]?.attributes).toEqual({ colspan: "2" });
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
    @cell colspan=2 rowspan=3: Merged`;
    
    const ast = parse(input);
    const cell = (ast.body[0] as any).rows[0].cells[0];
    
    expect(cell.colspan).toBe(2);
    expect(cell.rowspan).toBe(3);
    expect(cell.attributes).toEqual({ colspan: "2", rowspan: "3" });
  });
});
