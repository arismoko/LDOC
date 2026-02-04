export function flattenMeta(data: Record<string, any>, prefix = ""): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenMeta(value, fullKey));
      result[key] = value; // Also keep nested object for path access
    } else {
      result[fullKey] = value;
      result[key] = value;
    }
  }

  return result;
}
