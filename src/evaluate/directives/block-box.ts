/**
 * @box directive handler.
 *
 * Emits a Box IR node — a visual container with borders on all four sides.
 * Distinct from @blockquote which uses left-border-only quote styling.
 */

import { makeContainerHandler } from "./block-container.ts";

export const handleBox = makeContainerHandler("Box");
