import { describe, test, expect } from "bun:test";
import { tokenize } from "../src/parse/lexer.ts";
import { parse } from "../src/parse/parser.ts";
import { bindSync } from "../src/bind/binder.ts";

function parseAndBind(source: string) {
  const { tokens } = tokenize(source);
  const { cst } = parse(tokens);
  return bindSync(cst);
}

describe("Simple Bind", () => {
  test("collects macro", () => {
    const source = "@define(greeting, name)\n    Hello";
    const result = parseAndBind(source);
    expect(result.symbols.macros.has("greeting")).toBe(true);
  });
});
