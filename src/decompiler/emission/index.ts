/**
 * Emission Layer
 *
 * Final layer that generates LDOC syntax from semantic tree.
 * All LDOC text output is created here.
 */

// Types
export type { EmissionContext, EmissionOptions } from "./types";
export { createContext, indentContext, tableContext } from "./types";

// Inline emission
export { emitInlineContent, normalizeEmittedText } from "./inline";

// Block emission
export { emitParagraph, emitGroup, emitNode, emitNodes } from "./block";

// Table emission
export { emitTable } from "./table";

// Document emission
export { emitDocument, emitWithContext } from "./emitter";
