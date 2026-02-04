import { test, expect, describe } from "bun:test";
import { diffLdoc } from "../src/diff";

describe("diffLdoc", () => {
  test("identical content with different indentation produces empty diff", () => {
    // Same content but with different indentation styles
    const textA = `@if condition
  Then branch
@end
`;
    const textB = `@if condition
    Then branch
@end
`;

    const changes = diffLdoc(textA, textB);

    // After formatting, both should be identical
    // Either empty array or single common change
    const hasOnlyCommon = changes.every((c) => !c.added && !c.removed);
    expect(hasOnlyCommon).toBe(true);
  });

  test("different content shows additions and removals", () => {
    const textA = `Hello world
`;
    const textB = `Goodbye world
`;

    const changes = diffLdoc(textA, textB);

    // Should have additions and removals
    const hasAdditions = changes.some((c) => c.added);
    const hasRemovals = changes.some((c) => c.removed);

    expect(hasAdditions).toBe(true);
    expect(hasRemovals).toBe(true);
  });

  test("added content shows as addition", () => {
    const textA = `First paragraph
`;
    const textB = `First paragraph

Second paragraph
`;

    const changes = diffLdoc(textA, textB);

    const hasAdditions = changes.some((c) => c.added);
    expect(hasAdditions).toBe(true);

    // Original content should still be present (not removed)
    const removedContent = changes
      .filter((c) => c.removed)
      .map((c) => c.value)
      .join("");
    expect(removedContent).not.toContain("First paragraph");
  });

  test("removed content shows as removal", () => {
    const textA = `First paragraph

Second paragraph
`;
    const textB = `First paragraph
`;

    const changes = diffLdoc(textA, textB);

    const hasRemovals = changes.some((c) => c.removed);
    expect(hasRemovals).toBe(true);
  });

  test("whitespace-only differences are normalized", () => {
    // Tabs vs spaces
    const textA = `@box
\tHello
`;
    const textB = `@box
    Hello
`;

    const changes = diffLdoc(textA, textB);

    // After formatting, both use tabs, so should be identical
    const hasOnlyCommon = changes.every((c) => !c.added && !c.removed);
    expect(hasOnlyCommon).toBe(true);
  });
});
