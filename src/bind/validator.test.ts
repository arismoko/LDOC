import { describe, expect, test } from "bun:test";

import { parseAndBind } from "../pipeline/index.ts";

describe("bind validator diagnostics", () => {
  test("suggests nearest directive name for unknown directives", () => {
    const source = `@colums(count: 2){ [A] }`;
    const { diagnostics } = parseAndBind(source);
    const diag = diagnostics.find((value) => value.code === "B020");

    expect(diag).toBeDefined();
    expect(diag?.message.includes("Did you mean '@columns'?")).toBe(true);
    expect(diag?.suggestions?.[0]?.replacement).toBe("@columns");
  });

  test("adds fix-it hint for misplaced header/footer region directives", () => {
    const source = `@left[Header Text]`;
    const { diagnostics } = parseAndBind(source);
    const diag = diagnostics.find(
      (value) =>
        value.code === "B021" &&
        value.message.includes("header/footer region"),
    );

    expect(diag).toBeDefined();
    expect(diag?.suggestions?.[0]?.message.includes("@header")).toBe(true);
  });
});
