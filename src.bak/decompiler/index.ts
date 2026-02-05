export * from "./docx";
export type { DecompilerOptions, DecompileResult } from "./docx";

// Re-export main function as 'decompile' for consistency with compiler
import { docxToLdoc } from "./docx";
export const decompile = docxToLdoc;
