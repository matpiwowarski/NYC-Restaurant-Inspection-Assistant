import { Injectable } from "@nestjs/common";

export interface TocEntry {
  code: string;
  title: string;
  fullText?: string;
}

@Injectable()
export class HealthCodeParsingService {
  /**
   * Identifies chapter number from header (e.g. "ARTICLE 81").
   */
  extractChapterNumber(text: string): string {
    const headerMatch = text.match(/ARTICLE\s+(\d+)/i);
    return headerMatch ? headerMatch[1] : "\\d+";
  }

  /**
   * Normalizes document text.
   */
  flattenText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  /**
   * Extracts the Table of Contents from the beginning of the text.
   * Assumes the TOC starts with the first §{code} and ends when that same code repeats in the body.
   */
  /**
   * Extracts the Table of Contents by scanning the flattened text stream.
   * Looks for the pattern: §{Code} {Title}.
   * Stops when the first Code repeats (indicating start of body).
   */
  extractTableOfContents(
    flatText: string,
    chapterNumber: string
  ): { entries: TocEntry[]; bodyStartIndex: number } {
    const entries: TocEntry[] = [];

    // Regex to find potential section headers: §81.01 Title.
    // We assume the title ends at the first dot.
    // We use a global regex to iterate through the string.
    const headerRegex = new RegExp(
      `§\\s*(${chapterNumber}\\.\\d+)\\s+([^§]*?)\\.`,
      "g"
    );

    let firstCode: string | null = null;
    let match: RegExpExecArray | null;

    // We scan the text linearly
    while ((match = headerRegex.exec(flatText)) !== null) {
      const code = match[1];
      const rawTitle = match[2];
      const fullMatchIndex = match.index;

      // If we see the first code again, we've hit the body
      if (firstCode && code === firstCode) {
        // We found the start of the body content
        return { entries, bodyStartIndex: fullMatchIndex };
      }

      if (!firstCode) {
        firstCode = code;
      }

      // Sanitize title: remove extra spaces
      const title = rawTitle.replace(/\s+/g, " ").trim();

      entries.push({ code, title });
    }

    // Fallback if no repeat found (unlikely in this document structure)
    return { entries, bodyStartIndex: -1 };
  }

  /**
   * Splits the full text using the TOC entries as strict delimiters.
   */
  /**
   * Splits the full text using strict delimiters found in TOC.
   * Delimiter: "§{code} {title}."
   */
  splitFullTextByTOC(flatText: string, toc: TocEntry[]): TocEntry[] {
    const results: TocEntry[] = [];

    for (let i = 0; i < toc.length; i++) {
      const current = toc[i];
      const next = toc[i + 1];

      // strict start marker: exactly "§81.xx Title."
      // We assume one space between code and title for robustness, but text is flattened.
      const startMarker = `§${current.code} ${current.title}.`;
      // Escape for regex
      const escapedStart = this.escapeRegex(startMarker).replace(
        /\\ /g,
        "\\s*"
      );
      const startRegex = new RegExp(escapedStart, "i");

      const startMatch = flatText.match(startRegex);

      if (!startMatch) {
        console.warn(
          `Could not find start for ${current.code}: "${startMarker}"`
        );
        continue;
      }

      const startIndex = startMatch.index! + startMatch[0].length;
      let endIndex = flatText.length;

      if (next) {
        const endMarker = `§${next.code} ${next.title}.`;
        const escapedEnd = this.escapeRegex(endMarker).replace(/\\ /g, "\\s*");
        const endRegex = new RegExp(escapedEnd, "i");
        const endMatch = flatText.match(endRegex);

        if (endMatch) {
          endIndex = endMatch.index!;
        }
      }

      const body = flatText.substring(startIndex, endIndex).trim();

      results.push({
        code: current.code,
        title: current.title,
        fullText: body,
      });
    }

    return results;
  }

  chunkTextBySentence(text: string): string[] {
    if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
      const segmenter = new (Intl as any).Segmenter("en", {
        granularity: "sentence",
      });
      const segments = segmenter.segment(text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(segments)
        .map((s: any) => s.segment.trim())
        .filter((s: any) => s.length > 0);
    }

    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g);
    if (!sentences) return [text];

    return sentences.map((s) => s.trim());
  }

  private escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
