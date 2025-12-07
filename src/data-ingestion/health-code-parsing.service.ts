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
      // Trim whitespace and remove trailing dot if present
      const title = match[2].trim().replace(/\.$/, "");
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
    code: string
  ): { content: string; remainingText: string } {
    // Find the section header starting with §<code>
    // We assume TOC headers are already removed, so first match is the content.
    // We look for §<code> followed by boundary chars or space?
    // Actually the text might start with "§81.01 Scope..."
    // Let's find "§<code>" literally.
    const escapedCode = code.replace(".", "\\.");
    const regex = new RegExp(`§${escapedCode}`);
    const match = fullText.match(regex);

    if (!match) {
      return { content: "", remainingText: fullText };
    }

    const startIndex = match.index!;

    // Find the next section start (any § followed by digit) AFTER this start
    const nextSectionRegex = /§\d/g;
    nextSectionRegex.lastIndex = startIndex + match[0].length;
    const nextMatch = nextSectionRegex.exec(
      fullText.slice(nextSectionRegex.lastIndex)
    );
    // Wait, exec on slice is tricky with indices.
    // Let's just search substring.
    const textAfterStart = fullText.slice(startIndex + match[0].length);
    const nextSectionIndexRelative = textAfterStart.search(/§\d/);

    let endIndex = fullText.length;
    if (nextSectionIndexRelative !== -1) {
      endIndex = startIndex + match[0].length + nextSectionIndexRelative;
    }

    // Extract raw content including the header (we'll consume it)
    // Actually user wants "fullText" probably *excluding* the header?
    // "po drugim wystąpieniu title będzie występował fullText"
    // But now we are consuming.
    // If I extract "§81.01 Scope... content...", I should probably trim the header part?
    // The previous implementation of `extractSections` gave us the header.
    // Let's assume if it's the only one, it's the content.
    // User said "wyciągać fullText do MongoDB za pomocą samych kodów".
    // Usually fullText includes the section header for context.
    // Let's extract from startIndex to endIndex.

    let content = fullText.slice(startIndex, endIndex);

    // Normalize content
    content = content.replace(/\s+/g, " ");

    // Remove the extracted part from fullText for "destructive" behavior
    // We replace the EXACT range with empty string (or space?)
    const remainingText =
      fullText.slice(0, startIndex) + fullText.slice(endIndex);

    // Provide clean content (remove leading dot/space as requested before)
    // The header "§81.01 Scope" is inside `content`.
    // The user requirement "Remove leading dot/space" was for the *body* content.
    // If we include header, we shouldn't strip the "§".
    // Wait, the previous logic extracted content *after* the header.
    // If I include the header now, is that what user wants?
    // "po drugim wystąpieniu title będzie występował fullText" suggests separate fields.
    // I have `title` in DB.
    // So `fullText` should probably be just the body.

    // Let's try to identify the header end.
    // The header is `§<code> <title>`.
    // I can construct a regex for `§<code>.*?<title>`?
    // But the title might have been trimmed.
    // Let's aggressively consume `§81.01` and whatever follows until we hit something that looks like body?
    // Or simpler: The "Block" is extracted and removed from `remainingText`.
    // The "Content" (returned) is the Block processed to remove the Header.

    // Let's find the First `.`? Or end of line (but we flattened lines).
    // The title usually ends with `.` in the PDF.
    // Let's try to remove `§${escapedCode}.*?\.` (non greedy match until first dot).

    const block = fullText.slice(startIndex, endIndex);
    const remaining = fullText.slice(0, startIndex) + fullText.slice(endIndex);

    // Remove header from block to get content
    // Aggressive regex: start with §, code, anything, dot.
    const contentBody = block
      .replace(new RegExp(`^§${escapedCode}.*?\\.`), "")
      .trim();

    // Clean leading chars just in case (like spaces or extra dots)
    const cleanContent = contentBody.replace(/^[\.\s]+/, "").trim();

    return { content: cleanContent, remainingText: remaining };
  }
}
