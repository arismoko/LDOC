/**
 * Extraction Layer
 *
 * Provides functions to extract raw data from DOCX XML.
 * No LDOC syntax is generated at this layer.
 */

export * from "./types";
export { extractRunElements, parseRunStyle, isTextRun } from "./run";
export { extractParagraph } from "./paragraph";
export { extractTable } from "./table";
export { extractBodyElements } from "./body";
