/**
 * Shared filter utilities for variable substitution.
 */

export const applyFilters = (value: string, filters: string[]): string => {
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
    }
  }
  return result;
};
