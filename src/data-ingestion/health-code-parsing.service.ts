import { Injectable } from "@nestjs/common";

@Injectable()
export class HealthCodeParsingService {
  extractArticleCode(text: string): string | null {
    // Look for "ARTICLE" followed by a number at the start of the string (ignoring case/whitespace)
    const match = text.match(/^\s*ARTICLE\s+(\d+)/i);
    return match ? match[1] : null;
  }

  extractSections(
    text: string,
    articleCode: string
  ): { code: string; title: string; rawMatch: string }[] {
    // Regex to find sections: §(articleCode.number) whitespace (content until next § or end)
    const regex = new RegExp(`§(${articleCode}\\.\\d+)\\s+([^§]+)`, "g");
    const matches = [...text.matchAll(regex)];

    const uniqueSections = new Map<
      string,
      { title: string; rawMatch: string }
    >();

    for (const match of matches) {
      const code = match[1];
      // Trim whitespace and remove trailing dot if present. Normalize whitespace since fullText is raw.
      const title = match[2].replace(/\s+/g, " ").trim().replace(/\.$/, "");
      const rawMatch = match[0];

      // Only store the first occurrence to avoid overwriting with references later in text
      if (!uniqueSections.has(code)) {
        uniqueSections.set(code, { title, rawMatch });
      }
    }

    return Array.from(uniqueSections.entries()).map(
      ([code, { title, rawMatch }]) => ({
        code,
        title,
        rawMatch,
      })
    );
  }

  removeSectionHeader(fullText: string, rawMatch: string): string {
    // Replace only the FIRST occurrence of the raw match
    return fullText.replace(rawMatch, "");
  }

  extractContentByCode(
    fullText: string,
    code: string,
    nextCode?: string
  ): { content: string; remainingText: string } {
    // Find the section header starting with §<code>
    const escapedCode = code.replace(".", "\\.");
    const regex = new RegExp(`§${escapedCode}`);
    const match = fullText.match(regex);

    if (!match) {
      return { content: "", remainingText: fullText };
    }

    const startIndex = match.index!;

    let endIndex = fullText.length;

    if (nextCode) {
      // If we know the next section code, look for it specifically
      const escapedNextCode = nextCode.replace(".", "\\.");
      // Search for nextCode but ONLY if it appears at the start of a line (ignoring leading whitespace)
      // Use 'm' flag so ^ matches start of lines
      // Use 'g' flag so we can set lastIndex to skip the current header
      const nextRegex = new RegExp(`^\\s*§${escapedNextCode}`, "gm");

      // Start searching after the current section header
      nextRegex.lastIndex = startIndex + match[0].length;

      const nextMatch = nextRegex.exec(fullText);

      if (nextMatch) {
        endIndex = nextMatch.index;
      }
    } else {
      // Last section? Fallback to searching for ANY next section-like pattern might be risky if we want to include everything?
      // Or if there is an extraction of Article 81, maybe stop at "ARTICLE"?
      // For now, let's keep "to end of text" as per previous behavior for the last item,
      // or re-evaluate if we want `§\d` fallback.
      // User request only mentioned "until next code starts", implying strictness.
      // If no next code, we go to end.
    }

    let content = fullText.slice(startIndex, endIndex);

    // Normalize content
    content = content.replace(/\s+/g, " ");

    // Remove the extracted part from fullText
    const remainingText =
      fullText.slice(0, startIndex) + fullText.slice(endIndex);

    // Remove header from block to get content
    // Aggressive regex: start with §, code, anything, dot.
    const contentBody = content
      .replace(new RegExp(`^§${escapedCode}.*?\\.`), "")
      .trim();

    // Clean leading chars
    const cleanContent = contentBody.replace(/^[\.\s]+/, "").trim();

    return { content: cleanContent, remainingText: remainingText };
  }

  splitIntoSentences(text: string): string[] {
    // Using Intl.Segmenter for better accuracy
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
      return Array.from(segmenter.segment(text))
        .map((s) => s.segment.trim())
        .filter((s) => s.length > 0);
    }

    // Fallback regex
    return text.match(/[^.?!]+[.?!]+(\s|$)/g)?.map((s) => s.trim()) || [text];
  }
}
