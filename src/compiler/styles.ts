import { HeadingLevel } from "docx";

/** Style applied while compiling inline/block content. */
export interface TextStyle {
  bold?: boolean;
  italics?: boolean;
  allCaps?: boolean;
  smallCaps?: boolean;
  size?: number;
  font?: string;
  color?: string; // 6-hex without '#'
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Parsed style settings for a target (body, heading, header, footer, etc.) */
export interface StyleSettings {
  font?: string;
  size?: number; // half-points (docx run.size)
  bold?: boolean;
  italic?: boolean;
  color?: string; // 6-hex without '#'
}

/** Merged style configuration from @styles directives */
export interface StyleConfig {
  body?: StyleSettings;
  heading?: StyleSettings;
  heading1?: StyleSettings;
  heading2?: StyleSettings;
  heading3?: StyleSettings;
  heading4?: StyleSettings;
  heading5?: StyleSettings;
  heading6?: StyleSettings;
  header?: StyleSettings;
  footer?: StyleSettings;
}

export function parseStyleArgs(args: string, line: number, column: number): StyleSettings {
  const settings: StyleSettings = {};
  if (!args.trim()) return settings;

  // Parse key=value pairs, handling quoted font names
  let i = 0;
  const s = args;
  const skipWs = () => {
    while (i < s.length && /\s/.test(s[i]!)) i++;
  };

  while (i < s.length) {
    skipWs();
    if (i >= s.length) break;

    // Read key
    const keyStart = i;
    while (i < s.length && /[a-zA-Z0-9_]/.test(s[i]!)) i++;
    const key = s.slice(keyStart, i).toLowerCase();
    if (!key) {
      throw new Error(`@styles: expected key at line ${line}, column ${column}`);
    }

    skipWs();
    if (s[i] !== "=") {
      throw new Error(`@styles: expected '=' after '${key}' at line ${line}, column ${column}`);
    }
    i++; // skip =
    skipWs();

    // Read value (possibly quoted)
    let value: string;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i]!;
      i++;
      const valStart = i;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") i++; // skip escaped char
        i++;
      }
      value = s.slice(valStart, i);
      if (s[i] === quote) i++;
    } else {
      const valStart = i;
      while (i < s.length && !/\s/.test(s[i]!)) i++;
      value = s.slice(valStart, i);
    }

    // Apply to settings
    switch (key) {
      case "font":
        settings.font = value;
        break;
      case "size": {
        // Must be in pt, convert to half-points for docx
        const m = value.match(/^([0-9]+(?:\.[0-9]+)?)pt$/i);
        if (!m) {
          throw new Error(`@styles: size must be in pt (e.g. 12pt) at line ${line}, column ${column}. Got: ${value}`);
        }
        const pt = parseFloat(m[1]!);
        settings.size = Math.round(pt * 2); // half-points
        break;
      }
      case "bold":
        settings.bold = value.toLowerCase() === "true";
        break;
      case "italic":
        settings.italic = value.toLowerCase() === "true";
        break;
      case "color": {
        // Expect #RRGGBB, normalize to 6-hex without '#'
        const colorMatch = value.match(/^#?([0-9A-Fa-f]{6})$/);
        if (!colorMatch) {
          throw new Error(`@styles: color must be #RRGGBB (e.g. #333333) at line ${line}, column ${column}. Got: ${value}`);
        }
        settings.color = colorMatch[1]!.toUpperCase();
        break;
      }
      default:
        throw new Error(`@styles: unknown key '${key}' at line ${line}, column ${column}. Valid keys: font, size, bold, italic, color`);
    }
  }

  return settings;
}

export function buildDocumentStyles(styleConfig: StyleConfig): any {
  // If no style config, return undefined to preserve default behavior
  if (Object.keys(styleConfig).length === 0) {
    return undefined;
  }

  const styles: any = {};

  // Build default run properties for body text
  if (styleConfig.body) {
    const bodySettings = styleConfig.body;
    const runProps: any = {};
    if (bodySettings.font) runProps.font = bodySettings.font;
    if (bodySettings.size !== undefined) runProps.size = bodySettings.size;
    if (bodySettings.bold !== undefined) runProps.bold = bodySettings.bold;
    if (bodySettings.italic !== undefined) runProps.italics = bodySettings.italic;
    if (bodySettings.color) runProps.color = bodySettings.color;

    if (Object.keys(runProps).length > 0) {
      styles.default = {
        document: {
          run: runProps,
        },
      };
    }
  }

  // Build paragraph styles for headings, header, footer
  const paragraphStyles: any[] = [];

  // Helper to build a paragraph style entry
  const buildParagraphStyle = (id: string, name: string, settings: StyleSettings) => {
    const style: any = { id, name };
    const runProps: any = {};
    const paragraphProps: any = {};

    if (settings.font) runProps.font = settings.font;
    if (settings.size !== undefined) runProps.size = settings.size;
    if (settings.bold !== undefined) runProps.bold = settings.bold;
    if (settings.italic !== undefined) runProps.italics = settings.italic;
    if (settings.color) runProps.color = settings.color;

    if (Object.keys(runProps).length > 0) {
      style.run = runProps;
    }
    if (Object.keys(paragraphProps).length > 0) {
      style.paragraph = paragraphProps;
    }

    return style;
  };

  // Heading styles - specific heading levels (heading1-heading6)
  const headingLevelMap: Record<string, { id: string; name: string }> = {
    heading1: { id: "Heading1", name: "Heading 1" },
    heading2: { id: "Heading2", name: "Heading 2" },
    heading3: { id: "Heading3", name: "Heading 3" },
    heading4: { id: "Heading4", name: "Heading 4" },
    heading5: { id: "Heading5", name: "Heading 5" },
    heading6: { id: "Heading6", name: "Heading 6" },
  };

  // Apply generic "heading" style to all heading levels as a base
  if (styleConfig.heading) {
    for (const [key, info] of Object.entries(headingLevelMap)) {
      // Merge generic heading with specific if exists
      const specific = styleConfig[key as keyof StyleConfig];
      const merged = { ...styleConfig.heading, ...(specific ?? {}) };
      paragraphStyles.push(buildParagraphStyle(info.id, info.name, merged));
    }
  } else {
    // Only apply specific heading styles
    for (const [key, info] of Object.entries(headingLevelMap)) {
      const specific = styleConfig[key as keyof StyleConfig];
      if (specific) {
        paragraphStyles.push(buildParagraphStyle(info.id, info.name, specific));
      }
    }
  }

  // Header style
  if (styleConfig.header) {
    paragraphStyles.push(buildParagraphStyle("Header", "Header", styleConfig.header));
  }

  // Footer style
  if (styleConfig.footer) {
    paragraphStyles.push(buildParagraphStyle("Footer", "Footer", styleConfig.footer));
  }

  if (paragraphStyles.length > 0) {
    styles.paragraphStyles = paragraphStyles;
  }

  return Object.keys(styles).length > 0 ? styles : undefined;
}

export function getBodyStyle(styleConfig: StyleConfig): TextStyle {
  const s = styleConfig.body;
  if (!s) return {};
  const style: TextStyle = {};
  if (s.font) style.font = s.font;
  if (s.size !== undefined) style.size = s.size;
  if (s.bold) style.bold = s.bold;
  if (s.italic) style.italics = s.italic;
  if (s.color) style.color = s.color;
  return style;
}

export function getHeaderStyle(styleConfig: StyleConfig): TextStyle {
  const s = styleConfig.header;
  if (!s) return {};
  const style: TextStyle = {};
  if (s.font) style.font = s.font;
  if (s.size !== undefined) style.size = s.size;
  if (s.bold) style.bold = s.bold;
  if (s.italic) style.italics = s.italic;
  if (s.color) style.color = s.color;
  return style;
}

export function getFooterStyle(styleConfig: StyleConfig): TextStyle {
  const s = styleConfig.footer;
  if (!s) return {};
  const style: TextStyle = {};
  if (s.font) style.font = s.font;
  if (s.size !== undefined) style.size = s.size;
  if (s.bold) style.bold = s.bold;
  if (s.italic) style.italics = s.italic;
  if (s.color) style.color = s.color;
  return style;
}

export function getHeadingStyle(styleConfig: StyleConfig, level: 1 | 2 | 3 | 4 | 5 | 6): TextStyle {
  const generic = styleConfig.heading;
  const specific = styleConfig[`heading${level}` as keyof StyleConfig];
  const merged = { ...(generic ?? {}), ...(specific ?? {}) };
  if (Object.keys(merged).length === 0) return {};
  const style: TextStyle = {};
  if (merged.font) style.font = merged.font;
  if (merged.size !== undefined) style.size = merged.size;
  if (merged.bold) style.bold = merged.bold;
  if (merged.italic) style.italics = merged.italic;
  if (merged.color) style.color = merged.color;
  return style;
}

export function getHeadingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    case 6:
      return HeadingLevel.HEADING_6;
    default:
      return HeadingLevel.HEADING_1;
  }
}
