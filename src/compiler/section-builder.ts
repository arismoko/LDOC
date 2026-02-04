// Section Builder for DOCX Compiler
// Manages section creation, including columns regions

import { Header, Footer, Paragraph, Table, SectionType } from "docx";
import type { ISectionOptions } from "docx";

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

export interface BasePageProps {
  margin?: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  size?: {
    width?: number;
    height?: number;
    orientation?: any;
  };
}

export interface ColumnsConfig {
  count: number;
  space: number;
  separate: boolean;
}

/**
 * SectionBuilder manages the creation of DOCX sections.
 * It handles:
 * - First section special case (titlePage for first-page headers/footers)
 * - Continuous section breaks for columns
 * - Page properties (margins, size)
 * - Headers/Footers (default, first, even)
 */
export class SectionBuilder {
  private sections: ISectionOptions[] = [];
  private currentChildren: (Paragraph | Table)[] = [];
  private isFirstSection = true;

  private readonly hasFirst: boolean;
  private readonly hasHeadersOrFooters: boolean;

  constructor(
    private readonly basePageProps: BasePageProps,
    private readonly headers: SectionHeaders,
    private readonly footers: SectionFooters
  ) {
    this.hasFirst = Boolean(headers.first || footers.first);
    this.hasHeadersOrFooters =
      Object.keys(headers).some((k) => headers[k as keyof SectionHeaders] !== undefined) ||
      Object.keys(footers).some((k) => footers[k as keyof SectionFooters] !== undefined);
  }

  /**
   * Appends content to the current section.
   */
  addChildren(children: (Paragraph | Table)[]): void {
    this.currentChildren.push(...children);
  }

  /**
   * Finishes the current section and starts a columns section with the given content.
   */
  addColumns(children: (Paragraph | Table)[], count: number, space: number, separate: boolean): void {
    // Finish any pending content before columns
    this.finishSection();

    // Set the columns content and finish with columns config
    this.currentChildren = children;
    this.finishSection({ count, space, separate });
  }

  /**
   * Finishes building and returns the list of ISectionOptions.
   */
  finish(): ISectionOptions[] {
    // Finish the last section if there's pending content or no sections yet
    if (this.currentChildren.length > 0 || this.sections.length === 0) {
      this.finishSection();
    }

    // If still no sections, create an empty one
    if (this.sections.length === 0) {
      this.sections.push(this.createEmptySection());
    }

    return this.sections;
  }

  private finishSection(columnsConfig?: ColumnsConfig): void {
    if (this.currentChildren.length === 0 && !columnsConfig) {
      // Don't create empty sections unless it's a columns section
      return;
    }

    const sectionProps: any = {};

    // First section gets titlePage for first-page headers/footers
    if (this.isFirstSection) {
      sectionProps.titlePage = this.hasFirst;
    } else {
      // Subsequent sections use continuous section break
      sectionProps.type = SectionType.CONTINUOUS;
    }

    // Apply page properties
    if (Object.keys(this.basePageProps).length > 0) {
      sectionProps.page = { ...this.basePageProps };
    }

    // Apply columns configuration
    if (columnsConfig) {
      sectionProps.column = {
        count: columnsConfig.count,
        space: columnsConfig.space,
        separate: columnsConfig.separate,
      };
    }

    // Build section headers/footers objects (only include non-undefined entries)
    const sectionHeaders: any = {};
    const sectionFooters: any = {};
    if (this.headers.default) sectionHeaders.default = this.headers.default;
    if (this.headers.first) sectionHeaders.first = this.headers.first;
    if (this.headers.even) sectionHeaders.even = this.headers.even;
    if (this.footers.default) sectionFooters.default = this.footers.default;
    if (this.footers.first) sectionFooters.first = this.footers.first;
    if (this.footers.even) sectionFooters.even = this.footers.even;

    this.sections.push({
      properties: sectionProps,
      headers: this.isFirstSection && Object.keys(sectionHeaders).length ? sectionHeaders : undefined,
      footers: this.isFirstSection && Object.keys(sectionFooters).length ? sectionFooters : undefined,
      children: this.currentChildren,
    });

    this.currentChildren = [];
    this.isFirstSection = false;
  }

  private createEmptySection(): ISectionOptions {
    const sectionHeaders: any = {};
    const sectionFooters: any = {};
    if (this.headers.default) sectionHeaders.default = this.headers.default;
    if (this.headers.first) sectionHeaders.first = this.headers.first;
    if (this.headers.even) sectionHeaders.even = this.headers.even;
    if (this.footers.default) sectionFooters.default = this.footers.default;
    if (this.footers.first) sectionFooters.first = this.footers.first;
    if (this.footers.even) sectionFooters.even = this.footers.even;

    return {
      properties: {
        titlePage: this.hasFirst,
        ...(Object.keys(this.basePageProps).length ? { page: this.basePageProps } : {}),
      },
      headers: Object.keys(sectionHeaders).length ? sectionHeaders : undefined,
      footers: Object.keys(sectionFooters).length ? sectionFooters : undefined,
      children: [],
    };
  }
}
