import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser/parser";
import { MacroExpander } from "../src/compiler/expansion/expander";
import type { SetNode, ParagraphNode, TextNode } from "../src/parser/ast";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("Expected non-null value");
  }
  return value;
}

describe("@set directive", () => {
  describe("Parser", () => {
    test("parses simple @set with literal", () => {
      const ast = parse("@set(count, value: 1)");
      expect(ast.body.length).toBe(1);
      const node = ast.body[0] as SetNode;
      expect(node.type).toBe("set");
      expect(node.name).toBe("count");
      expect(node.expression).toBe("1");
    });

    test("parses @set with string literal", () => {
      const ast = parse('@set(name, value: "Alice")');
      expect(ast.body.length).toBe(1);
      const node = ast.body[0] as SetNode;
      expect(node.type).toBe("set");
      expect(node.name).toBe("name");
      expect(node.expression).toBe('"Alice"');
    });

    test("parses @set with dot path", () => {
      const ast = parse('@set(user.name, value: "Bob")');
      expect(ast.body.length).toBe(1);
      const node = ast.body[0] as SetNode;
      expect(node.type).toBe("set");
      expect(node.name).toBe("user.name");
      expect(node.expression).toBe('"Bob"');
    });

    test("parses @set with math expression", () => {
      const ast = parse("@set(total, value: price * quantity)");
      expect(ast.body.length).toBe(1);
      const node = ast.body[0] as SetNode;
      expect(node.type).toBe("set");
      expect(node.name).toBe("total");
      expect(node.expression).toBe("price * quantity");
    });

    test("throws on missing arguments", () => {
      expect(() => parse("@set count")).toThrow("@set requires v2 syntax");
    });

    test("throws on v1 syntax without parens", () => {
      expect(() => parse("@set count 1")).toThrow("@set requires v2 syntax");
    });

    test("throws on v1 syntax with equals", () => {
      expect(() => parse("@set count = 1")).toThrow("@set requires v2 syntax");
    });
  });

  describe("Expander", () => {
    test("@set updates local scope with literal", async () => {
      const source = `@set(count, value: 5)
Count is {{count}}`;
      const ast = parse(source);
      const expander = new MacroExpander({});
      const expanded = await expander.expand(ast);

      // First node is @set (consumed, not in output)
      // Second node should be paragraph with the evaluated variable
      expect(expanded.body.length).toBe(1);
      const para = expanded.body[0] as ParagraphNode;
      expect(para.type).toBe("paragraph");
      // The variable should be present (variable nodes are not substituted until render)
      const varNode = must(para.content.find((n) => n.type === "variable"));
      expect((varNode as any).path).toEqual(["count"]);
    });

    test("@set evaluates math expressions", async () => {
      const source = `@set(x, value: 2 + 3)
Value is {{x}}`;
      const ast = parse(source);
      const expander = new MacroExpander({});
      const expanded = await expander.expand(ast);

      expect(expanded.body.length).toBe(1);
    });

    test("@set can reference globals", async () => {
      const source = `@set(doubled, value: amount * 2)
Result: {{doubled}}`;
      const ast = parse(source);
      const expander = new MacroExpander({ amount: 10 });
      const expanded = await expander.expand(ast);

      expect(expanded.body.length).toBe(1);
    });

    test("@set creates nested objects for dot paths", async () => {
      const source = `@set(user.name, value: "Alice")
@set(user.age, value: 30)
Hello {{user.name}}`;
      const ast = parse(source);
      const expander = new MacroExpander({});
      const expanded = await expander.expand(ast);

      // Two @set nodes are consumed, only paragraph remains
      expect(expanded.body.length).toBe(1);
    });

    test("@set inside @if block", async () => {
      const source = `@if(true)
  @set(value, value: 42)
@end
Value: {{value}}`;
      const ast = parse(source);
      const expander = new MacroExpander({});
      const expanded = await expander.expand(ast);

      // @if with @set inside produces no nodes, only paragraph
      expect(expanded.body.length).toBe(1);
    });

    test("@set inside @foreach block", async () => {
      const source = `@set(sum, value: 0)
@foreach(item, in: items)
  @set(sum, value: sum + item)
@end
Sum: {{sum}}`;
      const ast = parse(source);
      const expander = new MacroExpander({ items: [1, 2, 3] });
      const expanded = await expander.expand(ast);

      // Only the final paragraph remains
      expect(expanded.body.length).toBe(1);
    });

    test("@set with boolean expression", async () => {
      const source = `@set(flag, value: 1 > 0)
@if(flag)
  It is true
@end`;
      const ast = parse(source);
      const expander = new MacroExpander({});
      const expanded = await expander.expand(ast);

      // The paragraph "It is true" should be present
      expect(expanded.body.length).toBe(1);
      const para = expanded.body[0] as ParagraphNode;
      expect(para.type).toBe("paragraph");
      const text = must(para.content.find((n) => n.type === "text")) as TextNode;
      expect(text.value).toContain("It is true");
    });
  });
});
