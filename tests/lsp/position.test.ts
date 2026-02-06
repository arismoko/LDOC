/**
 * LSP Position Utilities Tests
 */

import { describe, test, expect } from "bun:test";
import {
  sourceLocationToRange,
  positionInLocation,
  positionToOffset,
  offsetToPosition,
} from "../../src/lsp/position.ts";
import { loc } from "../../src/types/source-location.ts";

describe("sourceLocationToRange", () => {
  test("converts single-line location", () => {
    // SourceLocation: line 1 (1-based), column 5 (0-based), end line 1, end column 10
    const sourceLoc = loc(1, 5, 1, 10);
    const range = sourceLocationToRange(sourceLoc);
    
    // LSP: line 0 (0-based), character 5, end line 0, end character 10
    expect(range.start.line).toBe(0);
    expect(range.start.character).toBe(5);
    expect(range.end.line).toBe(0);
    expect(range.end.character).toBe(10);
  });

  test("converts multi-line location", () => {
    const sourceLoc = loc(5, 0, 8, 15);
    const range = sourceLocationToRange(sourceLoc);
    
    expect(range.start.line).toBe(4);
    expect(range.start.character).toBe(0);
    expect(range.end.line).toBe(7);
    expect(range.end.character).toBe(15);
  });

  test("handles first line correctly", () => {
    const sourceLoc = loc(1, 0, 1, 5);
    const range = sourceLocationToRange(sourceLoc);
    
    expect(range.start.line).toBe(0);
    expect(range.start.character).toBe(0);
  });
});

describe("positionInLocation", () => {
  test("position at start is inside", () => {
    const sourceLoc = loc(1, 5, 1, 10);
    // LSP position: line 0 (maps to source line 1), character 5
    expect(positionInLocation({ line: 0, character: 5 }, sourceLoc)).toBe(true);
  });

  test("position at end is outside (half-open interval)", () => {
    const sourceLoc = loc(1, 5, 1, 10);
    // At the end character - outside because [start, end) is half-open
    expect(positionInLocation({ line: 0, character: 10 }, sourceLoc)).toBe(false);
  });

  test("position just before end is inside", () => {
    const sourceLoc = loc(1, 5, 1, 10);
    // Just before end
    expect(positionInLocation({ line: 0, character: 9 }, sourceLoc)).toBe(true);
  });

  test("position before start is outside", () => {
    const sourceLoc = loc(1, 5, 1, 10);
    expect(positionInLocation({ line: 0, character: 4 }, sourceLoc)).toBe(false);
  });

  test("position after end is outside", () => {
    const sourceLoc = loc(1, 5, 1, 10);
    expect(positionInLocation({ line: 0, character: 11 }, sourceLoc)).toBe(false);
  });

  test("position on earlier line is outside", () => {
    const sourceLoc = loc(5, 0, 5, 10);
    expect(positionInLocation({ line: 3, character: 5 }, sourceLoc)).toBe(false);
  });

  test("position on later line is outside", () => {
    const sourceLoc = loc(5, 0, 5, 10);
    expect(positionInLocation({ line: 5, character: 5 }, sourceLoc)).toBe(false);
  });

  test("position in multi-line location", () => {
    const sourceLoc = loc(2, 0, 5, 10);
    // Line 3 (LSP) = source line 4, which is between 2 and 5
    expect(positionInLocation({ line: 3, character: 5 }, sourceLoc)).toBe(true);
  });
});

describe("positionToOffset", () => {
  test("first character", () => {
    const text = "Hello\nWorld";
    expect(positionToOffset(text, { line: 0, character: 0 })).toBe(0);
  });

  test("middle of first line", () => {
    const text = "Hello\nWorld";
    expect(positionToOffset(text, { line: 0, character: 3 })).toBe(3);
  });

  test("start of second line", () => {
    const text = "Hello\nWorld";
    // "Hello\n" = 6 characters (including newline)
    expect(positionToOffset(text, { line: 1, character: 0 })).toBe(6);
  });

  test("middle of second line", () => {
    const text = "Hello\nWorld";
    // "Hello\n" = 6, then "Wor" = 3
    expect(positionToOffset(text, { line: 1, character: 3 })).toBe(9);
  });

  test("character beyond line length is clamped", () => {
    const text = "Hi\nWorld";
    // Line 0 has 2 chars, asking for char 10 should give offset 2
    expect(positionToOffset(text, { line: 0, character: 10 })).toBe(2);
  });

  test("line beyond end returns end of text", () => {
    const text = "Hello";
    expect(positionToOffset(text, { line: 5, character: 0 })).toBe(5);
  });

  test("empty text", () => {
    expect(positionToOffset("", { line: 0, character: 0 })).toBe(0);
    expect(positionToOffset("", { line: 1, character: 5 })).toBe(0);
  });
});

describe("offsetToPosition", () => {
  test("offset 0", () => {
    const text = "Hello\nWorld";
    const pos = offsetToPosition(text, 0);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(0);
  });

  test("middle of first line", () => {
    const text = "Hello\nWorld";
    const pos = offsetToPosition(text, 3);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(3);
  });

  test("at newline character", () => {
    const text = "Hello\nWorld";
    // Offset 5 is the newline character, after "Hello"
    const pos = offsetToPosition(text, 5);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(5);
  });

  test("start of second line", () => {
    const text = "Hello\nWorld";
    // Offset 6 is 'W' in "World"
    const pos = offsetToPosition(text, 6);
    expect(pos.line).toBe(1);
    expect(pos.character).toBe(0);
  });

  test("middle of second line", () => {
    const text = "Hello\nWorld";
    // Offset 9 is 'l' in "World"
    const pos = offsetToPosition(text, 9);
    expect(pos.line).toBe(1);
    expect(pos.character).toBe(3);
  });

  test("offset beyond text length is clamped", () => {
    const text = "Hi";
    const pos = offsetToPosition(text, 100);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(2);
  });

  test("negative offset returns start", () => {
    const text = "Hello";
    const pos = offsetToPosition(text, -5);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(0);
  });

  test("empty text", () => {
    const pos = offsetToPosition("", 0);
    expect(pos.line).toBe(0);
    expect(pos.character).toBe(0);
  });
});

describe("round-trip conversion", () => {
  test("position -> offset -> position", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const original = { line: 1, character: 3 };
    
    const offset = positionToOffset(text, original);
    const result = offsetToPosition(text, offset);
    
    expect(result.line).toBe(original.line);
    expect(result.character).toBe(original.character);
  });

  test("offset -> position -> offset", () => {
    const text = "Hello\nWorld\nTest";
    const original = 10; // 'r' in "World"
    
    const pos = offsetToPosition(text, original);
    const result = positionToOffset(text, pos);
    
    expect(result).toBe(original);
  });
});
