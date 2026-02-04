/**
 * LDOC Diff - Semantic comparison of LDOC files
 *
 * Compares two LDOC files by first formatting them with consistent
 * indentation, then performing a line-by-line diff.
 */

import { diffLines, type Change } from "diff";
import { format } from "../formatter";

/**
 * Compare two LDOC sources semantically
 * @param textA - First LDOC source
 * @param textB - Second LDOC source
 * @returns Array of changes from diffLines
 */
export function diffLdoc(textA: string, textB: string): Change[] {
  // Format both sources with tabs for consistent comparison
  const fmtA = format(textA, { useTabs: true });
  const fmtB = format(textB, { useTabs: true });

  return diffLines(fmtA, fmtB);
}

export type { Change };
