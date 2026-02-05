import { test, expect, describe } from "bun:test";
import { Parser } from "../src/parser/parser";
import { DocxNodeVisitor } from "../src/compiler/visitors/docx-visitor";
import { createContext } from "../src/compiler/context";
import { Table, TableLayoutType } from "docx";

describe("Nested Columns Layout", () => {
  test("columns region serializes with AUTOFIT layout attribute", () => {
    const input = `
@columns(2)
Column 1 content
@break
Column 2 content
@end
`;
    const parser = new Parser();
    const ast = parser.parse(input);
    
    // Find the columns region node
    const columnsNode = ast.body.find((c: any) => c.type === "columns_region");
    if (!columnsNode) {
      throw new Error("Could not find columns_region node in AST");
    }

    const ctx = createContext();
    const visitor = new DocxNodeVisitor(ctx);
    
    const result = visitor.visit(columnsNode);
    
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Table);
    
    const table = result[0] as Table;
    const json = JSON.parse(JSON.stringify(table));
    
    // 1. Verify layout type is autofit
    const tblPr = json.root.find((c: any) => c.rootKey === "w:tblPr");
    const tblPrChildren = tblPr.children || tblPr.root;
    const tblLayout = tblPrChildren.find((c: any) => c.rootKey === "w:tblLayout");
    const tblLayoutRoot = tblLayout.root || tblLayout.children;
    const typeObj = tblLayoutRoot[0].root || tblLayoutRoot[0];
    expect(typeObj.type).toBe("autofit");
    
    // 2. Verify table width is PERCENTAGE 100% (5000)
    const tblW = tblPrChildren.find((c: any) => c.rootKey === "w:tblW");
    const tblWRoot = tblW.root || tblW.children;
    const wObj = tblWRoot[0].root || tblWRoot[0];
    
    // wObj might be the object itself or contain value
    let actualType = wObj.value || wObj.type;
    if (typeof actualType === 'object' && actualType.value) {
        actualType = actualType.value;
    }
    expect(actualType).toBe("pct");
    
    // Check width value
    // It might be in a sibling object or property depending on structure
    // Let's just check the JSON string for "5000" and "pct" inside tblW context
    // But let's try to be precise if we can.
    
    // If wObj is { key: "w:type", value: "pct" }, then the width value is likely in another object in tblWRoot
    const wValObj = tblWRoot.find((c: any) => c.key === "w:w" || (c.root && c.root.key === "w:w"));
    if (wValObj) {
        const val = wValObj.value || (wValObj.root && wValObj.root.value);
        expect(val).toBe("5000");
    } else {
        // Fallback: check if wObj has w property
        if (wObj.w) expect(wObj.w).toBe("5000");
    }
    
    // 3. Verify cells HAVE explicit widths (pct) to distribute columns evenly
    const rows = json.root.filter((c: any) => c.rootKey === "w:tr");
    const rowChildren = rows[0].children || rows[0].root;
    const cells = rowChildren.filter((c: any) => c.rootKey === "w:tc");
    
    for (const cell of cells) {
      const tcPr = (cell.children || cell.root).find((c: any) => c.rootKey === "w:tcPr");
      expect(tcPr).toBeDefined();
      
      const tcW = (tcPr.children || tcPr.root).find((c: any) => c.rootKey === "w:tcW");
      expect(tcW).toBeDefined();
      
      const tcWRoot = tcW.root || tcW.children;
      const tcWObj = tcWRoot[0].root || tcWRoot[0];
      
      // Should be pct
      let type = tcWObj.type;
      if (typeof type === 'object') type = type.value;
      expect(type).toBe("pct");
      
      // Should be 50% (2500)
      let w = tcWObj.w;
      if (typeof w === 'object') w = w.value;
      
      // Fallback for w value
      if (w === undefined) {
          const str = JSON.stringify(tcWObj);
          if (str.includes("2500")) w = "2500";
      }
      
      expect(w).toBe("2500");
    }
  });

  test("3 columns region compiles to a Table with AUTOFIT layout", () => {
    const input = `
@columns(3)
Col 1
@break
Col 2
@break
Col 3
@end
`;
    const parser = new Parser();
    const ast = parser.parse(input);
    const columnsNode = ast.body.find((c: any) => c.type === "columns_region");
    if (!columnsNode) throw new Error("Could not find columns_region node");

    const ctx = createContext();
    const visitor = new DocxNodeVisitor(ctx);
    const result = visitor.visit(columnsNode);
    
    expect(result).toHaveLength(1);
    const table = result[0] as Table;
    
    // Verify structural correctness
    // We expect 1 row with 3 cells
    const tableAny = table as any;
    
    // In docx, rows are often stored in the 'root' or 'options' depending on version/internal structure
    // But we can check the JSON structure which is reliable for the generated XML tree
    const jsonStr = JSON.stringify(table);
    const json = JSON.parse(jsonStr);
    
    // The structure is roughly:
    // {
    //   "root": [
    //     { "rootKey": "w:tblPr", ... },
    //     { "rootKey": "w:tblGrid", ... },
    //     { "rootKey": "w:tr", children: [ { "rootKey": "w:tc" }, ... ] }
    //   ]
    // }
    
    const rows = json.root.filter((c: any) => c.rootKey === "w:tr");
    expect(rows).toHaveLength(1);
    
    // console.log("Row structure:", JSON.stringify(rows[0], null, 2));
    
    // In some versions, children might be in 'root' property of the row object if it's a wrapper
    const rowChildren = rows[0].children || rows[0].root;
    
    const cells = rowChildren.filter((c: any) => c.rootKey === "w:tc");
    expect(cells).toHaveLength(3);
    
    // Verify autofit property is set in tblPr
    const tblPr = json.root.find((c: any) => c.rootKey === "w:tblPr");
    const tblPrChildren = tblPr.children || tblPr.root;
    const tblLayout = tblPrChildren.find((c: any) => c.rootKey === "w:tblLayout");
    
    // tblLayout might have children or root depending on structure
    const tblLayoutRoot = tblLayout.root || tblLayout.children;
    // The type is usually in the first child's root object
    const typeObj = tblLayoutRoot[0].root || tblLayoutRoot[0];
    
    expect(typeObj.type).toBe("autofit");
  });

  test("4 columns region compiles to a Table with AUTOFIT layout", () => {
    const input = `
@columns(4)
Col 1
@break
Col 2
@break
Col 3
@break
Col 4
@end
`;
    const parser = new Parser();
    const ast = parser.parse(input);
    const columnsNode = ast.body.find((c: any) => c.type === "columns_region");
    if (!columnsNode) throw new Error("Could not find columns_region node");

    const ctx = createContext();
    const visitor = new DocxNodeVisitor(ctx);
    const result = visitor.visit(columnsNode);
    
    expect(result).toHaveLength(1);
    const table = result[0] as Table;
    
    const jsonStr = JSON.stringify(table);
    const json = JSON.parse(jsonStr);
    
    const rows = json.root.filter((c: any) => c.rootKey === "w:tr");
    expect(rows).toHaveLength(1);
    
    const rowChildren = rows[0].children || rows[0].root;
    const cells = rowChildren.filter((c: any) => c.rootKey === "w:tc");
    expect(cells).toHaveLength(4);
    
    const tblPr = json.root.find((c: any) => c.rootKey === "w:tblPr");
    const tblPrChildren = tblPr.children || tblPr.root;
    const tblLayout = tblPrChildren.find((c: any) => c.rootKey === "w:tblLayout");
    
    const tblLayoutRoot = tblLayout.root || tblLayout.children;
    const typeObj = tblLayoutRoot[0].root || tblLayoutRoot[0];
    
    expect(typeObj.type).toBe("autofit");
  });
});
