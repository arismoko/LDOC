import { describe, expect, test } from "bun:test";

import { parseAndBind } from "../pipeline/index.ts";
import { getReferences } from "./navigation.ts";

describe("lsp navigation references", () => {
  test("returns definition and directive-arg references for def symbol", () => {
    const source = `@def(client: "Acme", title: "MSA")
@style(ref: "client")[Client heading]
@include(path: "snippet.ldoc", args: { name: "client" })
`;

    const { cst, symbols } = parseAndBind(source);
    const refs = getReferences(
      { cst, symbols, uri: "file:///test.ldoc" },
      { line: 0, character: 2 },
      true,
    );

    expect(refs.length).toBeGreaterThanOrEqual(3);
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
});
