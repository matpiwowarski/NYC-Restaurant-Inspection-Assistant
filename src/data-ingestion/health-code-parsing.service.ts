import { Injectable } from "@nestjs/common";

@Injectable()
export class HealthCodeParsingService {
  /**
   * Extracts the Chapter Number from the document header (e.g. "ARTICLE 81")
   * Returns a default regex string "\\d+" if not found, to imply broad matching.
   */
  extractChapterNumber(text: string): string {
    const headerMatch = text.match(/ARTICLE\s+(\d+)/i);
    return headerMatch ? headerMatch[1] : "\\d+";
  }

  /**
   * Flattens the text by removing newlines and collapsing multiple spaces.
   */
  flattenText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  /**
   * Splits the flattened text into sections based on the chapter number.
   * Pattern: Lookahead for "§ {ChapterNumber}.XX"
   */
  splitSections(text: string, chapterNumber: string): string[] {
    const splitRegex = new RegExp(`(?=§\\s*${chapterNumber}\\.\\d+)`, "g");
    return text.split(splitRegex);
  }

  /**
   * Parses a raw section string into structured data (code, title, body).
   * Returns null if the section is invalid (doesn't start with § or missing code).
   */
  parseSection(
    section: string
  ): { code: string; title: string; body: string } | null {
    if (!section.trim().startsWith("§")) return null;

    // Explanation:
    // ^      : Start of string
    // §      : Literal section symbol
    // \s*    : Optional whitespace
    // (\d+\.\d+) : Capture group for digits dot digits (e.g., 81.05)
    const codeMatch = section.match(/^§\s*(\d+\.\d+)/);
    if (!codeMatch) return null;

    const code = codeMatch[1];
    const afterCodeIndex = codeMatch[0].length;
    const restOfText = section.substring(afterCodeIndex).trim();

    // Strategy: Title is everything from the code end up to the FIRST period.
    // Body is everything after that period.
    const firstDotIndex = restOfText.indexOf(".");
    let title = "";
    let body = "";

    if (firstDotIndex === -1) {
      // Fallback: No dot found, entire text is title
      title = restOfText;
      body = "";
    } else {
      title = restOfText.substring(0, firstDotIndex).trim();
      body = restOfText.substring(firstDotIndex + 1).trim();
    }

    return { code, title, body };
  }

  /**
   * Splits text into individual sentences.
   * Uses a regex to split by common sentence terminators (. ! ?) followed by space or end of string.
   */
  chunkTextBySentence(text: string): string[] {
    // Regex explanation:
    // ([^.!?]+[.!?]+) : Match a sequence of non-terminators followed by terminators.
    // The match result will include the punctuation.
    // However, split might be better or match.
    // Using match with global flag is easier to extract "Sentence."

    // Pattern:
    // [^.!?]+   : One or more characters that are NOT terminators
    // [.!?]+    : One or more terminators
    // followed by end of string or space (to avoid splitting "e.g." or "81.05") -> this is hard with simple regex.

    // Simple heuristic for Health Code:
    // Split by `. ` or `? ` or `! ` or end of line.
    // But we need to keep the delimiter.

    // Let's use a capture group in split to keep delimiters, then rejoin?
    // Or just use a matchall.

    // Actually, "Intl.Segmenter" is great for this if available in the Node environment (Node 16+ has it).
    // Let's try Intl.Segmenter first as it's robust.

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

    // Fallback regex if Segmenter not available (though standard in recent Node)
    // Match anything ending in .!? followed by space or EOF
    // Note: Health codes have "81.05" which contains a dot but IS NOT a sentence end.
    // Usually section numbers are followed by space match the start of the line or section logic.
    // In the body text, "Refer to § 81.05." -> The dot at 81.05 might be tricky if not followed by space?
    // Actually "81.05" is a number. "Section 81.05 ends here."

    // Heuristic: Dot followed by Space.

    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g);
    if (!sentences) return [text];

    return sentences.map((s) => s.trim());
  }
}
