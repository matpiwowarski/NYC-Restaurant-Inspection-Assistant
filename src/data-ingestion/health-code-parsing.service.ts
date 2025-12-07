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
   * Splits a large body of text into smaller overlapping chunks.
   */
  chunkText(text: string, maxChunkSize = 500): string[] {
    const rawLines = text.split("\n"); // Note: Input might be flattened, so this might just be one line if passed flattened text?
    // Wait, in the ingestion service we had `fullText` which was the body.
    // If we flattened everything, `fullText` is just one line.
    // However, the original logic did: `const rawChunks = fullText.split("\n");`
    // If fullText is flattened, split("\n") returns [fullText].
    // Then it iterates and checks `currentChunk.length + line.length < 500`.
    // Effectively it just chunks by 500 chars if it's one long line.
    // BUT we want to be smart.
    // If `fullText` comes from `parseSection`, it was `flattenText`'ed. So no newlines.

    // So the previous logic `fullText.split("\n")` would have effectively been a no-op if fullText was already flat.
    // Let's implement a word-boundary aware chunker here instead, or keep the simple logic but know it won't split by newline.

    // Simple word-based chunker since we don't have newlines:
    const words = text.split(" ");
    const chunks: string[] = [];
    let currentChunk = "";

    for (const word of words) {
      if ((currentChunk + " " + word).length < maxChunkSize) {
        currentChunk += (currentChunk ? " " : "") + word;
      } else {
        chunks.push(currentChunk);
        currentChunk = word;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    return chunks;
  }
}
