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
   * Extracts the Table of Contents by scanning the flattened text stream.
   * Scans for §Code Title sequences.
   */
  extractTableOfContents(
    flatText: string,
    chapterNumber: string
  ): { entries: TocEntry[]; bodyStartIndex: number } {
    const entries: TocEntry[] = [];

    // Pattern: §(Code) (Title determined by lookahead to next § or end of string)
    // We capture (Code) and then (Title content)
    // We stop title at:
    // 1. The next "§"
    // 2. "ARTICLE" (start of next chapter?)
    // 3. End of line logic (we don't have lines, but maybe we can guess?)
    // Actually, in the summary/TOC area, titles are usually followed by...... page numbers?
    // Or just the next Section.
    // Let's assume the TOC block is consistent: §Code Title §Code Title...

    // We'll just look for §Code and capture until next §.
    // NOTE: This relies on the TOC being a contiguous block at the start.

    const tokenRegex = new RegExp(`§\\s*(${chapterNumber}\\.\\d+)`, "g");

    let match: RegExpExecArray | null;
    let lastIndex = -1;
    let lastCode: string | null = null;
    let bodyStartIndex = -1;

    // First pass: Identify all "§Code" positions
    const markers: { code: string; index: number }[] = [];
    while ((match = tokenRegex.exec(flatText)) !== null) {
      markers.push({ code: match[1], index: match.index });
    }

    if (markers.length === 0) return { entries: [], bodyStartIndex: -1 };

    // Detect where TOC ends and Body starts (First repeating code)
    const seenCodes = new Set<string>();
    let tocEndIndex = -1;

    for (const marker of markers) {
      if (seenCodes.has(marker.code)) {
        // Found duplicate! Body starts here.
        bodyStartIndex = marker.index;
        tocEndIndex = marker.index;
        break;
      }
      seenCodes.add(marker.code);
    }

    if (bodyStartIndex === -1) {
      // Fallback: If no duplicates, maybe the TOC is the whole file? Unlikely.
      // Or maybe we failed to find the body.
      return { entries, bodyStartIndex: -1 };
    }

    // Now extract titles for the TOC portion only
    // Iterate markers up to the body start
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (marker.index >= bodyStartIndex) break; // Stop at body

      const nextMarker = markers[i + 1];
      let endOfTitleIndex =
        nextMarker && nextMarker.index < bodyStartIndex
          ? nextMarker.index
          : bodyStartIndex;

      // Extract raw title text between this marker and the next
      // marker.index is start of "§...", we need to skip "§81.xx"
      const headerLength = 1 + marker.code.length; // § + Code roughly.
      // Better: find the end of the code in the actual text
      const codeEndSearch =
        flatText.indexOf(marker.code, marker.index) + marker.code.length;

      const rawTitle = flatText
        .substring(codeEndSearch, endOfTitleIndex)
        .trim();

      // Cleanup title:
      // 1. Remove trailing dots
      // 2. Remove trailing page numbers (digits at end) if any
      // 3. Remove extra spaces
      let cleanTitle = rawTitle.replace(/\.+$/, "").trim(); // remove trailing dots
      cleanTitle = cleanTitle.replace(/\s+/g, " "); // normalize spaces

      entries.push({ code: marker.code, title: cleanTitle });
    }

    return { entries, bodyStartIndex };
  }

  /**
   * Splits the full text using strict delimiters found in TOC.
   * Uses "Seek and Validate" fuzzy matching to find headers in the body.
   */
  splitFullTextByTOC(flatText: string, toc: TocEntry[]): TocEntry[] {
    const results: TocEntry[] = [];

    // We need to find the START indices of each section in the BODY.
    // Searching flatText for §{Code}

    // Optimization: Start searching from the known bodyStartIndex?
    // The previous method returned it, but here we just take the whole text
    // and can assume we search linearly.

    let searchCursor = 0;

    interface FoundSection {
      code: string;
      title: string;
      startIndex: number;
    }

    const foundSections: FoundSection[] = [];

    for (const entry of toc) {
      // Find §Code
      // We match "§81.01" explicitly
      const pattern = `§${entry.code}`;
      // we might have spaces? "§ 81.01"
      // Let's use simple indexOf for speed, then loop if false positive

      let position = flatText.indexOf(pattern, searchCursor);

      while (position !== -1) {
        // Check if this is a real header or a reference
        // "Real Header" validation:
        // 1. Located at 'position'
        // 2. Text immediately following '§Code' should fuzzily match 'entry.Title'

        const codeEnd = position + pattern.length;
        // conservative peek: look at next 50 chars
        const peekText = flatText.substring(codeEnd, codeEnd + 50).trim();

        if (this.isHeaderMatch(peekText, entry.title)) {
          // It's a match!
          foundSections.push({
            code: entry.code,
            title: entry.title,
            startIndex: position,
          });

          // Move cursor past this section start to avoid re-finding it
          searchCursor = position + 1;
          break; // Move to next TOC entry
        } else {
          // False positive (reference), keep looking
          position = flatText.indexOf(pattern, position + 1);
        }
      }

      if (position === -1) {
        console.warn(`Could not find body section for ${entry.code}`);
      }
    }

    // Now slice the text based on found start indices
    for (let i = 0; i < foundSections.length; i++) {
      const current = foundSections[i];
      const next = foundSections[i + 1];

      const end = next ? next.startIndex : flatText.length;
      const fullText = flatText.substring(current.startIndex, end).trim();

      results.push({
        code: current.code,
        title: current.title,
        fullText,
      });
    }

    return results;
  }

  /**
   * Fuzzy checks if the text looks like the title.
   * "Permitting requirements" matches "Permit requirements"
   */
  private isHeaderMatch(textStart: string, tocTitle: string): boolean {
    // Normalize: lowercase, remove non-alpha
    const cleanBody = textStart.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanToc = tocTitle.toLowerCase().replace(/[^a-z0-9]/g, "");

    // Heuristic: check if the first N characters match
    // length = min(5, minLength)
    const checkLen = Math.min(5, cleanBody.length, cleanToc.length);

    if (checkLen === 0) return true; // Empty title? Assume match.

    const bodyPrefix = cleanBody.substring(0, checkLen);
    const tocPrefix = cleanToc.substring(0, checkLen);

    return bodyPrefix === tocPrefix;
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
