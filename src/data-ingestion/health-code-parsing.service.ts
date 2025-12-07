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

    return matches.map((match) => ({
      code: match[1],
      title: match[2].trim(),
    }));
  }
}
