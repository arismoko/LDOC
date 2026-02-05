/**
 * Text filters for variable substitution.
 */

export type TextFilter = "upper" | "lower" | "capitalize" | "title";

/**
 * Apply a chain of filters to a string value.
 */
export function applyFilters(value: string, filters: TextFilter[]): string {
  let result = String(value);
  
  for (const filter of filters) {
    switch (filter) {
      case "upper":
        result = result.toUpperCase();
        break;
      case "lower":
        result = result.toLowerCase();
        break;
      case "capitalize":
        result = result.charAt(0).toUpperCase() + result.slice(1);
        break;
      case "title":
        result = result.replace(/\b\w/g, (c) => c.toUpperCase());
        break;
    }
  }
  
  return result;
}

/**
 * Check if a string is a valid filter name.
 */
export function isTextFilter(name: string): name is TextFilter {
  return ["upper", "lower", "capitalize", "title"].includes(name);
}
