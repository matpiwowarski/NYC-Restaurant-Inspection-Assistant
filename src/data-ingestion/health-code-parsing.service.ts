import { Injectable } from "@nestjs/common";

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
   * Splits text into sections using chapter number.
   */
  splitSections(text: string, chapterNumber: string): string[] {
    const splitRegex = new RegExp(`(?=§\\s*${chapterNumber}\\.\\d+)`, "g");
    return text.split(splitRegex);
  }

  /**
   * Extracts code, title, and body from section text.
   */
  parseSection(
    section: string
  ): { code: string; title: string; body: string } | null {
    if (!section.trim().startsWith("§")) return null;

    const codeMatch = section.match(/^§\s*(\d+\.\d+)/);
    if (!codeMatch) return null;

    const code = codeMatch[1];
    const afterCodeIndex = codeMatch[0].length;
    const restOfText = section.substring(afterCodeIndex).trim();

    const firstDotIndex = restOfText.indexOf(".");
    let title = "";
    let body = "";

    if (firstDotIndex === -1) {
      title = restOfText;
      body = "";
    } else {
      title = restOfText.substring(0, firstDotIndex).trim();
      body = restOfText.substring(firstDotIndex + 1).trim();
    }

    return { code, title, body };
  }

  /**
   * Splits text by sentence.
   */
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
}
