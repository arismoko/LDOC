/**
 * Pipeline integration tests.
 */

import { describe, test, expect } from "bun:test";
import { tryCompile } from "./index.ts";

describe("tryCompile", () => {
  test("returns diagnostics on parse failure", async () => {
    // Unterminated paragraph block should produce parse diagnostics
    const result = await tryCompile("[unterminated paragraph");
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test("returns diagnostics on successful compile", async () => {
    const result = await tryCompile("[Hello world]");
    expect(result.ok).toBe(true);
    // May or may not have diagnostics, but should not throw
    if (result.ok) {
      expect(result.value.buffer).toBeInstanceOf(Uint8Array);
    }
  });
});
