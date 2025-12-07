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
      const title = match[2].trim();

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
}
