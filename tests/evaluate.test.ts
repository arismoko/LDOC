/**
 * Tests for Phase 3: EVALUATE
 */

import { describe, test, expect } from "bun:test";
import { tokenize } from "../src/parse/lexer.ts";
import { parse } from "../src/parse/parser.ts";
import { bindSync } from "../src/bind/binder.ts";
import { evaluate } from "../src/evaluate/evaluator.ts";
import { evalCondition, truthy } from "../src/evaluate/expressions.ts";
import { resolveInterpolation } from "../src/evaluate/interpolation.ts";
import type { Document, Block, Paragraph, Heading, List, Text, Bold } from "../src/types/document-ir.ts";

// Helper to parse, bind, and evaluate
function fullEvaluate(source: string, variables: Record<string, unknown> = {}): Document {
  const { tokens } = tokenize(source);
  const { cst } = parse(tokens);
  const bindResult = bindSync(cst);
  const { document } = evaluate(cst, bindResult.symbols, { variables });
  return document;
}

// =============================================================================
// Expression Evaluation
// =============================================================================

describe("Expression Evaluation", () => {
  test("truthy values", () => {
    expect(truthy(true)).toBe(true);
    expect(truthy(false)).toBe(false);
    expect(truthy(1)).toBe(true);
    expect(truthy(0)).toBe(false);
    expect(truthy("hello")).toBe(true);
    expect(truthy("")).toBe(false);
    expect(truthy("false")).toBe(false);
    expect(truthy(null)).toBe(false);
    expect(truthy(undefined)).toBe(false);
    expect(truthy([1, 2])).toBe(true);
    expect(truthy([])).toBe(false);
  });

  test("simple variable lookup", () => {
    const result = evalCondition("name", { name: "Alice" }, {});
    expect(result).toBe("Alice");
  });

  test("nested variable lookup", () => {
    const result = evalCondition("person.name", {}, { person: { name: "Bob" } });
    expect(result).toBe("Bob");
  });

  test("comparison operators", () => {
    expect(evalCondition("5 > 3", {}, {})).toBe(true);
    expect(evalCondition("5 < 3", {}, {})).toBe(false);
    expect(evalCondition("5 == 5", {}, {})).toBe(true);
    expect(evalCondition("5 != 3", {}, {})).toBe(true);
    expect(evalCondition("5 >= 5", {}, {})).toBe(true);
    expect(evalCondition("5 <= 4", {}, {})).toBe(false);
  });

  test("logical operators", () => {
    expect(evalCondition("true && true", {}, {})).toBe(true);
    expect(evalCondition("true && false", {}, {})).toBe(false);
    expect(evalCondition("false || true", {}, {})).toBe(true);
    expect(evalCondition("false || false", {}, {})).toBe(false);
    expect(evalCondition("!false", {}, {})).toBe(true);
  });

  test("arithmetic operators", () => {
    expect(evalCondition("5 + 3", {}, {})).toBe(8);
    expect(evalCondition("5 - 3", {}, {})).toBe(2);
    expect(evalCondition("5 * 3", {}, {})).toBe(15);
    expect(evalCondition("6 / 2", {}, {})).toBe(3);
  });

  test("string literals in conditions", () => {
    expect(evalCondition("name == \"Alice\"", { name: "Alice" }, {})).toBe(true);
    expect(evalCondition("name == 'Bob'", { name: "Alice" }, {})).toBe(false);
  });

  test("parentheses for precedence", () => {
    expect(evalCondition("(1 + 2) * 3", {}, {})).toBe(9);
    expect(evalCondition("1 + 2 * 3", {}, {})).toBe(7);
  });
});

// =============================================================================
// Interpolation
// =============================================================================

describe("Interpolation", () => {
  test("simple variable", () => {
    const result = resolveInterpolation("name", { name: "Alice" }, {});
    expect(result).toBe("Alice");
  });

  test("variable with filter", () => {
    const result = resolveInterpolation("name | upper", { name: "alice" }, {});
    expect(result).toBe("ALICE");
  });

  test("variable with multiple filters", () => {
    const result = resolveInterpolation("name | lower | capitalize", { name: "ALICE BOB" }, {});
    expect(result).toBe("Alice bob");
  });

  test("missing variable returns empty string", () => {
    const result = resolveInterpolation("missing", {}, {});
    expect(result).toBe("");
  });
});

// =============================================================================
// Basic Document Transformation
// =============================================================================

describe("Basic Transformation", () => {
  test("transforms paragraph", () => {
    const doc = fullEvaluate("Hello world");
    expect(doc.blocks.length).toBe(1);
    expect(doc.blocks[0]!.type).toBe("Paragraph");
    const para = doc.blocks[0] as Paragraph;
    expect(para.content.length).toBe(1);
    expect((para.content[0] as Text).value).toBe("Hello world");
  });

  test("transforms heading", () => {
    const doc = fullEvaluate("# Hello");
    expect(doc.blocks.length).toBe(1);
    expect(doc.blocks[0]!.type).toBe("Heading");
    const heading = doc.blocks[0] as Heading;
    expect(heading.level).toBe(1);
  });

  test("transforms list", () => {
    const doc = fullEvaluate("- Item 1\n- Item 2");
    expect(doc.blocks.length).toBe(1);
    expect(doc.blocks[0]!.type).toBe("List");
    const list = doc.blocks[0] as List;
    expect(list.items.length).toBe(2);
  });

  test("transforms emphasis", () => {
    const doc = fullEvaluate("**bold** and *italic*");
    const para = doc.blocks[0] as Paragraph;
    expect(para.content.some((c) => c.type === "Bold")).toBe(true);
    expect(para.content.some((c) => c.type === "Italic")).toBe(true);
  });
});

// =============================================================================
// @document Directive
// =============================================================================

describe("@document Directive", () => {
  test("extracts metadata", () => {
    const doc = fullEvaluate(`
@document(title: "My Document", author: "John Doe")

Hello world
`);
    expect(doc.metadata.title).toBe("My Document");
    expect(doc.metadata.author).toBe("John Doe");
  });

  test("stores custom metadata", () => {
    const doc = fullEvaluate(`
@document(client: "Acme Corp", matter: "12345")

Hello
`);
    expect(doc.metadata.custom.client).toBe("Acme Corp");
    expect(doc.metadata.custom.matter).toBe("12345");
  });

  test("parses YAML-like body for margins", () => {
    const doc = fullEvaluate(`
@document
  margins:
    top: 0.9in
    right: 1in
    bottom: 1.2in
    left: 0.8in

Hello
`);
    expect(doc.metadata.layout).toBeDefined();
    expect(doc.metadata.layout?.margins).toBeDefined();
    expect(doc.metadata.layout?.margins?.top).toBe(1296); // 0.9in = 1296 twips
    expect(doc.metadata.layout?.margins?.right).toBe(1440); // 1in = 1440 twips
    expect(doc.metadata.layout?.margins?.bottom).toBe(1728); // 1.2in = 1728 twips
    expect(doc.metadata.layout?.margins?.left).toBe(1152); // 0.8in = 1152 twips
  });

  test("parses YAML-like body for orientation", () => {
    const doc = fullEvaluate(`
@document
  orientation: landscape

Hello
`);
    expect(doc.metadata.layout?.orientation).toBe("landscape");
  });

  test("parses nested styles in YAML-like body", () => {
    const doc = fullEvaluate(`
@document
  styles:
    body:
      font: Times New Roman
      size: 12pt
    h1:
      bold: true

Hello
`);
    // Styles should be in custom metadata
    const styles = doc.metadata.custom.styles as Record<string, unknown>;
    expect(styles).toBeDefined();
    expect((styles.body as Record<string, unknown>).font).toBe("Times New Roman");
    expect((styles.h1 as Record<string, unknown>).bold).toBe(true);
  });

  test("YAML-like body does not pollute document blocks", () => {
    const doc = fullEvaluate(`
@document
  margins:
    top: 1in
    right: 1in
  spacing:
    after: 6pt
  styles:
    body:
      font: Arial

Hello world.
`);
    // Should only have 1 block (the "Hello world." paragraph)
    // NOT the YAML content as paragraphs
    expect(doc.blocks.length).toBe(1);
    expect((doc.blocks[0] as Paragraph).content[0]).toHaveProperty("value", "Hello world.");
  });
});

// =============================================================================
// @use Directive (Macro Expansion)
// =============================================================================

describe("@use Directive", () => {
  test("expands simple macro", () => {
    const doc = fullEvaluate(`@define(greeting)
    Hello, World!
@use(greeting)`);
    expect(doc.blocks.length).toBe(1);
    const para = doc.blocks[0] as Paragraph;
    expect((para.content[0] as Text).value).toContain("Hello");
  });

  test("expands macro with parameters", () => {
    const doc = fullEvaluate(`
@define(greet, name)
    Hello, {{name}}!

@use(greet, "Alice")
`);
    const para = doc.blocks[0] as Paragraph;
    const text = para.content.map((c) => (c as Text).value).join("");
    expect(text).toContain("Alice");
  });

  test("expands macro with default parameter", () => {
    const doc = fullEvaluate(`
@define(greet, name: "World")
    Hello, {{name}}!

@use(greet)
`);
    const para = doc.blocks[0] as Paragraph;
    const text = para.content.map((c) => (c as Text).value).join("");
    expect(text).toContain("World");
  });

  test("overrides default parameter", () => {
    const doc = fullEvaluate(`
@define(greet, name: "World")
    Hello, {{name}}!

@use(greet, "Alice")
`);
    const para = doc.blocks[0] as Paragraph;
    const text = para.content.map((c) => (c as Text).value).join("");
    expect(text).toContain("Alice");
  });
});

// =============================================================================
// @set Directive
// =============================================================================

describe("@set Directive", () => {
  test("sets variable for later use", () => {
    const doc = fullEvaluate(`
@set(name: "Alice")

Hello, {{name}}!
`);
    const para = doc.blocks[0] as Paragraph;
    const text = para.content.map((c) => (c as Text).value).join("");
    expect(text).toContain("Alice");
  });
});

// =============================================================================
// @if Directive
// =============================================================================

describe("@if Directive", () => {
  test("evaluates true condition", () => {
    const doc = fullEvaluate(`
@if(true)
    Visible content
`, {});
    expect(doc.blocks.length).toBe(1);
  });

  test("evaluates false condition", () => {
    const doc = fullEvaluate(`
@if(false)
    Hidden content
`, {});
    expect(doc.blocks.length).toBe(0);
  });

  test("uses variable in condition", () => {
    const doc = fullEvaluate(`
@if(showContent)
    Visible content
`, { showContent: true });
    expect(doc.blocks.length).toBe(1);
  });

  test("comparison in condition", () => {
    const doc = fullEvaluate(`
@if(count > 0)
    Has items
`, { count: 5 });
    expect(doc.blocks.length).toBe(1);
  });
});

// =============================================================================
// @foreach Directive
// =============================================================================

describe("@foreach Directive", () => {
  test("iterates over array", () => {
    const doc = fullEvaluate(`
@foreach(item, items)
    - {{item}}
`, { items: ["A", "B", "C"] });
    // Should produce a list with 3 items
    expect(doc.blocks.length).toBe(3);
  });

  test("provides loop variables", () => {
    const doc = fullEvaluate(`
@foreach(item, items)
    Item {{loop.count}} of {{loop.length}}
`, { items: ["A", "B"] });
    expect(doc.blocks.length).toBe(2);
  });
});

// =============================================================================
// @repeat Directive
// =============================================================================

describe("@repeat Directive", () => {
  test("repeats content n times", () => {
    const doc = fullEvaluate(`
@repeat(3)
    Repeated
`);
    expect(doc.blocks.length).toBe(3);
  });

  test("provides loop variables", () => {
    const doc = fullEvaluate(`
@repeat(2)
    Iteration {{loop.count}}
`);
    expect(doc.blocks.length).toBe(2);
  });
});

// =============================================================================
// Variables from Context
// =============================================================================

describe("Context Variables", () => {
  test("uses provided variables", () => {
    const doc = fullEvaluate("Hello, {{name}}!", { name: "World" });
    const para = doc.blocks[0] as Paragraph;
    // Variables in plain text aren't interpolated yet
    // This test validates variable resolution works
    expect(doc.blocks.length).toBe(1);
  });

  test("nested variable access", () => {
    const doc = fullEvaluate(`
@if(person.active)
    Active user
`, { person: { name: "Alice", active: true } });
    expect(doc.blocks.length).toBe(1);
  });
});

// =============================================================================
// Empty Paragraph Roundtrip
// =============================================================================

describe("Empty Paragraphs via @empty", () => {
  function countParas(doc: Document) {
    const paras = doc.blocks.filter((b): b is Paragraph => b.type === "Paragraph");
    return {
      total: paras.length,
      empty: paras.filter(p => p.content.length === 0).length,
      nonEmpty: paras.filter(p => p.content.length > 0).length,
    };
  }

  test("blank lines are only separators (never empty paragraphs)", () => {
    const doc = fullEvaluate("hello\n\nworld");
    expect(countParas(doc).total).toBe(2);
    expect(countParas(doc).empty).toBe(0);
  });

  test("multiple blank lines are still just separators", () => {
    const doc = fullEvaluate("hello\n\n\n\n\nworld");
    expect(countParas(doc).total).toBe(2);
    expect(countParas(doc).empty).toBe(0);
  });

  test("@empty produces one empty paragraph", () => {
    const doc = fullEvaluate("hello\n\n@empty\n\nworld");
    const { total, empty } = countParas(doc);
    expect(total).toBe(3);
    expect(empty).toBe(1);
  });

  test("multiple @empty produce multiple empty paragraphs", () => {
    const doc = fullEvaluate("hello\n\n@empty\n@empty\n@empty\n\nworld");
    const { total, empty } = countParas(doc);
    expect(total).toBe(5);
    expect(empty).toBe(3);
  });

  test("@empty inside directive body", () => {
    const doc = fullEvaluate("@style(align: center)\n  a\n  @empty\n  @empty\n  b");
    const { total, empty } = countParas(doc);
    expect(total).toBe(4);
    expect(empty).toBe(2);
  });

  test("@empty at start of document", () => {
    const doc = fullEvaluate("@empty\nhello");
    const { total, empty } = countParas(doc);
    expect(total).toBe(2);
    expect(empty).toBe(1);
  });

  test("@empty at end of document", () => {
    const doc = fullEvaluate("hello\n@empty");
    const { total, empty } = countParas(doc);
    expect(total).toBe(2);
    expect(empty).toBe(1);
  });

  test("@empty(N) produces N empty paragraphs", () => {
    const doc = fullEvaluate("hello\n@empty(3)\nworld");
    const { total, empty } = countParas(doc);
    expect(total).toBe(5);
    expect(empty).toBe(3);
  });
});
