import { describe, test, expect } from "bun:test";
import { parse } from "../src/parser/parser";

describe("Parser Robustness", () => {
  test("throws error for misplaced @document instead of hanging", () => {
    const input = `
@center
  @document
    title: Foo
`;
    expect(() => parse(input)).toThrow(/Misplaced @document/);
  });

  test("throws error for misplaced @meta instead of hanging", () => {
    const input = `
@center
  @meta
    author: Me
`;
    expect(() => parse(input)).toThrow(/Misplaced @meta/);
  });

  test("throws error for misplaced @import instead of hanging", () => {
    const input = `
@center
  @import "foo.ldoc"
`;
    expect(() => parse(input)).toThrow(/Misplaced @import/);
  });
});
