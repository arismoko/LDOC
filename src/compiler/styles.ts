import { AlignmentType, HeadingLevel } from "docx";
import type { CoreTextStyle } from "../shared/style-types";

/** Style applied while compiling inline/block content. */
export interface TextStyle extends CoreTextStyle {
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
}

/** Parsed style settings for a target (body, heading, header, footer, etc.) */
export interface StyleSettings {
  font?: string;
  size?: number; // half-points (docx run.size)
  bold?: boolean;
  italic?: boolean;
  color?: string; // 6-hex without '#'
  align?: "left" | "center" | "right" | "justify";
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

export function buildDocumentStyles(
  styleConfig: StyleConfig,
  defaultSpacing?: { before?: number; after?: number; line?: number }
): any {
  // If no style config and no spacing, return undefined to preserve default behavior
  if (Object.keys(styleConfig).length === 0 && !defaultSpacing) {
    return undefined;
  }

  const styles: any = {};

  // Build default run properties for body text
  if (styleConfig.body || defaultSpacing) {
    const bodySettings = styleConfig.body ?? {};
    const runProps: any = {};
    if (bodySettings.font) runProps.font = bodySettings.font;
    if (bodySettings.size !== undefined) runProps.size = bodySettings.size;
    if (bodySettings.bold !== undefined) runProps.bold = bodySettings.bold;
    if (bodySettings.italic !== undefined) runProps.italics = bodySettings.italic;
    if (bodySettings.color) runProps.color = bodySettings.color;

    // Build paragraph props with spacing and alignment
    const paragraphProps: any = {};
    if (defaultSpacing) {
      const spacing: any = {};
      if (defaultSpacing.after !== undefined) spacing.after = defaultSpacing.after;
      if (defaultSpacing.before !== undefined) spacing.before = defaultSpacing.before;
      if (defaultSpacing.line !== undefined) spacing.line = defaultSpacing.line;
      if (Object.keys(spacing).length > 0) {
        paragraphProps.spacing = spacing;
      }
    }
    // Add body alignment to paragraph defaults
    if (bodySettings.align) {
      switch (bodySettings.align) {
        case "justify":
          paragraphProps.alignment = AlignmentType.JUSTIFIED;
          break;
        case "center":
          paragraphProps.alignment = AlignmentType.CENTER;
          break;
        case "right":
          paragraphProps.alignment = AlignmentType.RIGHT;
          break;
        // "left" is default, no need to set
      }
    }

    if (Object.keys(runProps).length > 0 || Object.keys(paragraphProps).length > 0) {
      styles.default = {
        document: {},
      };
      if (Object.keys(runProps).length > 0) {
        styles.default.document.run = runProps;
      }
      if (Object.keys(paragraphProps).length > 0) {
        styles.default.document.paragraph = paragraphProps;
      }
    }
  }

  // Build paragraph styles for header, footer (not headings - those use default overrides)
  const paragraphStyles: any[] = [];

  // Helper to build run/paragraph props from settings
  const buildStyleProps = (settings: StyleSettings): { run?: any; paragraph?: any } => {
    const runProps: any = {};
    const paragraphProps: any = {};

    if (settings.font) runProps.font = settings.font;
    if (settings.size !== undefined) runProps.size = settings.size;
    if (settings.bold !== undefined) runProps.bold = settings.bold;
    if (settings.italic !== undefined) runProps.italics = settings.italic;
    if (settings.color) runProps.color = settings.color;

    // Paragraph alignment
    if (settings.align) {
      switch (settings.align) {
        case "center":
          paragraphProps.alignment = AlignmentType.CENTER;
          break;
        case "right":
          paragraphProps.alignment = AlignmentType.RIGHT;
          break;
        case "justify":
          paragraphProps.alignment = AlignmentType.JUSTIFIED;
          break;
        // "left" is default, no need to set
      }
    }

    const result: { run?: any; paragraph?: any } = {};
    if (Object.keys(runProps).length > 0) result.run = runProps;
    if (Object.keys(paragraphProps).length > 0) result.paragraph = paragraphProps;
    return result;
  };

  // Helper to build a paragraph style entry (for header/footer)
  const buildParagraphStyle = (id: string, name: string, settings: StyleSettings) => {
    const style: any = { id, name, ...buildStyleProps(settings) };
    return style;
  };

  // Heading styles use styles.default.heading1-heading6 to properly override built-in styles
  // (Using paragraphStyles creates duplicate Heading1 entries)
  styles.default = styles.default || {};

  const headingLevelKeys = ["heading1", "heading2", "heading3", "heading4", "heading5", "heading6"] as const;

  for (const key of headingLevelKeys) {
    // Merge generic heading with specific if exists
    const generic = styleConfig.heading;
    const specific = styleConfig[key];
    if (generic || specific) {
      const merged = { ...(generic ?? {}), ...(specific ?? {}) };
      const props = buildStyleProps(merged);
      if (props.run || props.paragraph) {
        styles.default[key] = props;
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
