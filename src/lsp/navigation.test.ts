import { describe, expect, test } from "bun:test";

import { parseAndBind } from "../pipeline/index.ts";
import { getDefinition, getReferences } from "./navigation.ts";

describe("lsp navigation references", () => {
  test("returns definition and directive-arg references for def symbol", () => {
    const source = `@def(client: "Acme", title: "MSA")
@style(ref: "client")[Client heading]
@style(ref: "client")[Client body]
`;

    const { cst, symbols } = parseAndBind(source);
    const refs = getReferences(
      { cst, symbols, uri: "file:///test.ldoc" },
      { line: 0, character: 2 },
      true,
    );

    expect(refs.length).toBe(3);
  });

  test("returns empty references when symbol cannot be resolved", () => {
    const source = `@style(ref: "missing")[Text]`;
    const { cst, symbols } = parseAndBind(source);
    const refs = getReferences(
      { cst, symbols, uri: "file:///test.ldoc" },
      { line: 0, character: 1 },
      true,
    );

    expect(refs).toHaveLength(0);
  });

  test("does not return same-line definition outside symbol span", () => {
    const source = `@def(client: "Acme")
[Body]
`;
    const { cst, symbols } = parseAndBind(source);
    const definition = getDefinition(
      { cst, symbols, uri: "file:///test.ldoc" },
      { line: 0, character: 80 },
    );

    expect(definition).toBeNull();
  });

  test("does not treat non-ref string args as def references", () => {
    const source = `@def(name: "client")
@include(path: "client")
`;
    const { cst, symbols } = parseAndBind(source);
    const refs = getReferences(
      { cst, symbols, uri: "file:///test.ldoc" },
      { line: 0, character: 2 },
      true,
    );

    expect(refs).toHaveLength(1);
  });
});
