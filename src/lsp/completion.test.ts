import { describe, expect, test } from "bun:test";

import { getCompletionItems } from "./completion.ts";
import { createSymbolTable } from "../types/symbols.ts";

describe("lsp completion", () => {
  test("returns directive list sourced from contracts", () => {
    const items = getCompletionItems(
      { kind: "directive", prefix: "" },
      createSymbolTable(),
      { snippetSupport: false },
    );

    const labels = items.map((item) => item.label);
    expect(labels.includes("@params")).toBe(true);
    expect(labels.includes("@row")).toBe(true);
    expect(labels.includes("@center")).toBe(true);
  });

  test("filters directive completion by prefix", () => {
    const items = getCompletionItems(
      { kind: "directive", prefix: "fo" },
      createSymbolTable(),
      { snippetSupport: false },
    );

    expect(items.length).toBe(1);
    expect(items[0]?.label).toBe("@footer");
  });
});
