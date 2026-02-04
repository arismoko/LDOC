import { describe, test, expect } from "bun:test";
import { compile } from "../src/compiler/docx";
import type { DocumentNode, ModifierNode, DocHeaderFooterNode, TextNode, ParagraphNode } from "../src/parser/ast";

describe("Compiler Error Handling", () => {
  test("throws error when @footer is nested inside a modifier", async () => {
    // AST representing:
    // @center
    //   @footer
    //     text
    const ast: DocumentNode = {
      type: "document",
      imports: [],
      line: 1,
      column: 1,
      body: [
        {
          type: "modifier",
          modifier: "center",
          content: [
            {
              type: "doc_footer",
              scope: "default",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", value: "Footer Text" } as TextNode],
                } as ParagraphNode,
              ],
            } as DocHeaderFooterNode,
          ],
        } as ModifierNode,
      ],
      document: {},
    };

    // Currently this does not throw, but we want it to.
    // We expect the compiler to detect the misplaced footer and throw.
    expect(compile(ast)).rejects.toThrow(/Misplaced @footer/);
  });

  test("throws error when @header is nested inside a modifier", async () => {
    const ast: DocumentNode = {
      type: "document",
      imports: [],
      line: 1,
      column: 1,
      body: [
        {
          type: "modifier",
          modifier: "box",
          content: [
            {
              type: "doc_header",
              scope: "default",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", value: "Header Text" } as TextNode],
                } as ParagraphNode,
              ],
            } as DocHeaderFooterNode,
          ],
        } as ModifierNode,
      ],
      document: {},
    };

    expect(compile(ast)).rejects.toThrow(/Misplaced @header/);
  });
});
