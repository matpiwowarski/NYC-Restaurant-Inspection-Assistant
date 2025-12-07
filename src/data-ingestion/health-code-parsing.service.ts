import { Injectable } from "@nestjs/common";

export interface TocEntry {
  code: string;
  title: string;
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
  extractTableOfContents(
    text: string,
    chapterNumber: string
  ): { entries: TocEntry[]; bodyStartIndex: number } {
    const entries: TocEntry[] = [];
    const lines = text.split("\n");

    const codeRegex = new RegExp(`^§\\s*(${chapterNumber}\\.\\d+)`);

    let firstCode: string | null = null;
    let bodyStartIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;

      const match = line.match(codeRegex);
      if (match) {
        const code = match[1];

        // If we see the first code AGAIN, we have hit the body content
        if (firstCode && code === firstCode) {
          bodyStartIndex = i;
          break;
        }

        if (!firstCode) {
          firstCode = code;
        }

        let title = line.substring(match[0].length).trim();

        // Handle multi-line titles in TOC?
        // Simple heuristic: if the next line does NOT start with § or Page Number or Page Header, append it.
        // For this dataset, titles seem to be single line or we can accept partial titles.
        // Let's stick to single line for now as per "debug-pdf" output which shows clean one-liners.

        entries.push({ code, title });
      }
    }

    // If we didn't find the loop, search in the raw text for the first occurrence AFTER the TOC block
    // But lines-based approach is safer.
    return { entries, bodyStartIndex };
  }

  /**
   * Splits the full text using the TOC entries as strict delimiters.
   */
  splitFullTextByTOC(text: string, toc: TocEntry[]): TocEntry[] {
    const results: TocEntry[] = [];
    // We clean up newlines for easier searching, BUT we need to be careful not to merge words.
    // The previous 'flattenText' does this nicely.
    const flatText = this.flattenText(text);

    for (let i = 0; i < toc.length; i++) {
      const current = toc[i];
      const next = toc[i + 1];

      // We search for "§{code} {title}"
      // We must handle potential extra spaces between §, code, and title from the PDF flattening
      const startMarker = `§${current.code} ${current.title}`;
      const escapedStart = this.escapeRegex(startMarker).replace(
        /\\ /g,
        "\\s*"
      );
      const startRegex = new RegExp(escapedStart, "i");

      const match = flatText.match(startRegex);

      if (!match) {
        console.warn(`Could not find section body for ${current.code}`);
        continue; // Skip or handle error
      }

      const startIndex = match.index! + match[0].length;
      let endIndex = flatText.length;

      if (next) {
        const endMarker = `§${next.code} ${next.title}`;
        const escapedEnd = this.escapeRegex(endMarker).replace(/\\ /g, "\\s*");
        const endRegex = new RegExp(escapedEnd, "i");
        const endMatch = flatText.match(endRegex);

        if (endMatch) {
          endIndex = endMatch.index!;
        }
      }

      const body = flatText.substring(startIndex, endIndex).trim();
      // Only add if we actually found body text (sometimes TOC repeats headings)
      results.push({
        code: current.code,
        title: current.title,
        // The algorithm says: "All text until the next Code+Title" is the body.
        // But we want to store the FULL text (including title?)
        // The Type 'validSections' in IngestionService expects 'fullText'
        // Ideally fullText = Code + Title + Body? Or just Body?
        // Existing logic used 'parsed.body' distinct from title.
        // Let's store just the body content here as 'fullText' field implies content.
        // BUT wait, IngestionService uses `update: { fullText, title }`
        // So let's return it as `title` and `body` (mapped to fullText)
        // code and title are already provided above
      } as any);

      // Mutate the result to include body property directly or just return a new structure
      // Let's adhere to returning a list of objects with { code, title, body }
      (results[results.length - 1] as any).fullText = body;
    }

    return results as any;
  }

  chunkTextBySentence(text: string): string[] {
    if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
