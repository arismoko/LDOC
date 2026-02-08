/**
 * DOCX Section Handling
 * 
 * Manages section creation for headers, footers, and column layouts.
 */

import { Header, Footer, Paragraph, PageOrientation, SectionType } from "docx";
import type { ISectionOptions, Table, ISectionPropertiesOptions } from "docx";

import type { HeaderFooter } from "../../types/document-ir.ts";
import type { EmitContext, DocxBlock } from "./nodes.ts";
import { emitBlocks } from "./nodes.ts";
import { type Mutable } from "./utils.ts";

export interface SectionHeaders {
  default?: Header;
  first?: Header;
  even?: Header;
}

export interface SectionFooters {
  default?: Footer;
  first?: Footer;
  even?: Footer;
}

// =============================================================================
// Section Builder
// =============================================================================

/**
 * SectionBuilder manages DOCX section creation.
 * Handles first section special case, continuous breaks, headers/footers.
 */
export class SectionBuilder {
  private sections: ISectionOptions[] = [];
  private currentChildren: DocxBlock[] = [];
  private isFirstSection = true;

  constructor(
    private readonly pageWidth: number,
    private readonly pageHeight: number,
    private readonly margins: { top: number; bottom: number; left: number; right: number },
    private readonly headers: SectionHeaders = {},
    private readonly footers: SectionFooters = {},
    private readonly orientation?: "portrait" | "landscape",
  ) {}

  /**
   * Append content to the current section.
   */
  addChildren(children: DocxBlock[]): void {
    this.currentChildren.push(...children);
  }

  /**
   * Finish current section and start a columns section.
   */
  addColumns(children: DocxBlock[], count: number, space: number): void {
    this.finishSection();
    this.currentChildren = children;
    this.finishSection({ count, space, separate: false });
  }

  /**
   * Finish building and return section options array.
   */
  finish(): ISectionOptions[] {
    if (this.currentChildren.length > 0 || this.sections.length === 0) {
      this.finishSection();
    }

    if (this.sections.length === 0) {
      this.sections.push(this.createEmptySection());
    }

    return this.sections;
  }

  private get pageSizeOptions() {
    const isLandscape = this.orientation === "landscape";
    // The docx package internally swaps w:w/w:h when orientation is landscape,
    // so we must always pass logical portrait dimensions (width < height).
    // If callers already provide landscape-oriented dims (width > height),
    // normalize to portrait first to avoid a double-swap producing portrait output.
    let w = this.pageWidth;
    let h = this.pageHeight;
    if (isLandscape && w > h) {
      [w, h] = [h, w];
    }
    return {
      width: w,
      height: h,
      ...(isLandscape ? { orientation: PageOrientation.LANDSCAPE } : {}),
    };
  }

  private finishSection(columnsConfig?: { count: number; space: number; separate: boolean }): void {
    if (this.currentChildren.length === 0 && !columnsConfig) {
      return;
    }

    const properties: Mutable<ISectionPropertiesOptions> = {
      page: {
        size: this.pageSizeOptions,
        margin: this.margins,
      },
    };

    // First section gets titlePage for first-page headers/footers
    if (this.isFirstSection) {
      properties.titlePage = Boolean(this.headers.first || this.footers.first);
    } else {
      properties.type = SectionType.CONTINUOUS;
    }

    // Apply columns configuration
    if (columnsConfig) {
      properties.column = {
        count: columnsConfig.count,
        space: columnsConfig.space,
        separate: columnsConfig.separate,
      };
    }

    // Build section
    const section: Mutable<ISectionOptions> = {
      properties,
      children: this.currentChildren as (Paragraph | Table)[],
    };

    // Only first section gets headers/footers
    if (this.isFirstSection) {
      if (Object.keys(this.headers).length > 0) {
        section.headers = this.headers;
      }
      if (Object.keys(this.footers).length > 0) {
        section.footers = this.footers;
      }
    }

    this.sections.push(section);
    this.currentChildren = [];
    this.isFirstSection = false;
  }

  private createEmptySection(): ISectionOptions {
    const hasFirstPageSpecial = Boolean(this.headers.first || this.footers.first);
    
    return {
      properties: {
        page: {
          size: this.pageSizeOptions,
          margin: this.margins,
        },
        titlePage: hasFirstPageSpecial,
      },
      headers: Object.keys(this.headers).length > 0 ? this.headers : undefined,
      footers: Object.keys(this.footers).length > 0 ? this.footers : undefined,
      children: [],
    };
  }
}

// =============================================================================
// Header/Footer Compilation
// =============================================================================

/**
 * Compile header/footer IR to docx Header/Footer.
 */
export function compileHeader(headerFooter: HeaderFooter, ctx: EmitContext): Header {
  const children = emitBlocks(headerFooter.content, ctx);
  return new Header({
    children: children as (Paragraph | Table)[],
  });
}

export function compileFooter(headerFooter: HeaderFooter, ctx: EmitContext): Footer {
  const children = emitBlocks(headerFooter.content, ctx);
  return new Footer({
    children: children as (Paragraph | Table)[],
  });
}
