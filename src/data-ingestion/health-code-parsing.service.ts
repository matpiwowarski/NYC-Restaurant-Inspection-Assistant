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
  ): { code: string; title: string }[] {
    // Regex to find sections: §(articleCode.number) whitespace (content until next § or end)
    const regex = new RegExp(`§(${articleCode}\\.\\d+)\\s+([^§]+)`, "g");
    const matches = [...text.matchAll(regex)];

    const uniqueSections = new Map<string, string>();

    for (const match of matches) {
      const code = match[1];
      // Trim whitespace and remove trailing dot if present
      const title = match[2].trim().replace(/\.$/, "");

      // Only store the first occurrence to avoid overwriting with references later in text
      if (!uniqueSections.has(code)) {
        uniqueSections.set(code, title);
      }
    }

    return Array.from(uniqueSections.entries()).map(([code, title]) => ({
      code,
      title,
    }));
  }

  extractSectionContent(
    fullText: string,
    currentSection: { code: string; title: string },
    nextSection?: { code: string; title: string }
  ): string {
    // Helper to escape regex special characters in title
    const escapeRegExp = (string: string) => {
      return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
    };

    // Construct regex for the current section header: §<code> <title>
    // e.g. §81.01 Scope
    const currentHeaderRegex = new RegExp(
      `§${escapeRegExp(currentSection.code)}\\s+${escapeRegExp(
        currentSection.title
      )}`,
      "g"
    );

    const matches = [...fullText.matchAll(currentHeaderRegex)];

    // We need the SECOND match (index 1) because the first is likely in the Table of Contents
    if (matches.length < 2) {
      // If found less than 2 times, maybe there is no TOC or no body?
      // Fallback to first if only 1 found, or return empty if 0
      if (matches.length === 1) {
        // Warning: Only found once, might be just TOC or just Body.
        // If it's at the very beginning it's likely TOC.
        // Let's assume if it's the only one, it's the content.
        return ""; // Or handle differently? User insisted on 2nd occurrence. Let's return empty to be safe or maybe log?
      }
      return "";
    }

    const startMatch = matches[1]; // The second occurrence
    const startIndex = startMatch.index! + startMatch[0].length;

    let endIndex = fullText.length;

    if (nextSection) {
      // Find the next section header starting AFTER the current section content starts
      const nextHeaderRegex = new RegExp(
        `§${escapeRegExp(nextSection.code)}\\s+${escapeRegExp(
          nextSection.title
        )}`,
        "g"
      );

      // We look for matches of the NEXT section
      const nextMatches = [...fullText.matchAll(nextHeaderRegex)];

      // We want the first occurrence of the Next Section that appears AFTER our startIndex
      const nextMatch = nextMatches.find((m) => m.index! > startIndex);

      if (nextMatch) {
        endIndex = nextMatch.index!;
      }
    }

    return fullText.substring(startIndex, endIndex).trim().replace(/\s+/g, " ");
  }
}
