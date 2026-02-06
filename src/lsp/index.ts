/**
 * LSP module - Language Server Protocol implementation for LDOC.
 */

// Position utilities
export {
  sourceLocationToRange,
  positionInLocation,
  positionToOffset,
  offsetToPosition,
} from "./position.ts";

// Diagnostic conversion
export {
  toLspDiagnostic,
  toLspDiagnostics,
} from "./diagnostics.ts";

// Navigation (go-to-definition, find-references)
export {
  findNodeAtPosition,
  getDefinition,
  getReferences,
  type NavigationContext,
} from "./navigation.ts";

// Completion
export {
  getCompletionContext,
  getCompletionItems,
  type CompletionContext,
  type CompletionOptions,
} from "./completion.ts";

// Server
export { startServer } from "./server.ts";
