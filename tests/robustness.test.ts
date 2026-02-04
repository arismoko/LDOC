import { describe, test, expect } from "bun:test";
import { compile } from "../src/compiler/docx";
import { parse } from "../src/parser/parser";
import { expandDefinesAndUses } from "../src/compiler/expansion";

describe("Compiler Robustness & Bugs", () => {
  test("throws error for nested @define", async () => {
    const input = `
@center
  @define MyMacro
    Hello
`;
    const ast = parse(input);
    // Expect compile to fail because define is not extracted and reaches compileNode
    await expect(compile(ast)).rejects.toThrow(/Misplaced @define/);
  });

  test("throws error for nested @columns", async () => {
    const input = `
@center
  @columns 2
    Col 1
`;
    const ast = parse(input);
    // Expect compile to fail because columns_region is handled in main loop, not compileNode
    await expect(compile(ast)).rejects.toThrow(/Misplaced @columns/);
  });

  test("expands @use inside modifiers", async () => {
    const input = `
@define MyText
  Expanded Text

@center
  @use MyText
`;
    const ast = parse(input);
    const expanded = await expandDefinesAndUses(ast, {});
    
    // Check if @use was replaced
    // Note: @define is removed from body, so @center is at index 0
    const modifier = expanded.body[0] as any; // @center
    const content = modifier.content[0];
    
    // If expansion worked, content should be a paragraph with "Expanded Text"
    // If it failed, content is still type: "use"
    expect(content.type).not.toBe("use");
    expect(content.type).toBe("paragraph");
    expect(content.content[0].value).toBe("Expanded Text");
  });

  test("expands @use inside @if", async () => {
    const input = `
@define MyText
  Expanded Text

@if true
  @use MyText
@end
`;
    const ast = parse(input);
    const expanded = await expandDefinesAndUses(ast, {});
    
    // @define is removed.
    // @if is removed (pruned).
    // Result should be the content of @use.
    
    expect(expanded.body.length).toBeGreaterThanOrEqual(1);
    const para = expanded.body[0] as any;
    expect(para.type).toBe("paragraph");
    expect(para.content[0].value).toBe("Expanded Text");
  });
});
