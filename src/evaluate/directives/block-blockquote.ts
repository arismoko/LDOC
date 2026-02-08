/**
 * @blockquote directive handler.
 *
 * Emits a Blockquote IR node — quoted content with left-border indent styling.
 * Distinct from @box which uses all-four-sides border styling.
 */

import { makeContainerHandler } from "./block-container.ts";

export const handleBlockquote = makeContainerHandler("Blockquote");
