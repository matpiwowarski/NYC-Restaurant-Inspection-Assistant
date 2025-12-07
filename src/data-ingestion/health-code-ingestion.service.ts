/// <reference path="../types.d.ts" />
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FeatureExtractionService } from "./feature-extraction.service";
import * as fs from "fs";
import pdf from "pdf-parse";

@Injectable()
export class HealthCodeIngestionService {
  private readonly logger = new Logger(HealthCodeIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureExtractionService: FeatureExtractionService
  ) {}

  async ingestHealthCode(filePath: string) {
    this.logger.log(`Parsing Health Code PDF from: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);

    // 1. Detect the main Article Number from the document header (e.g. "ARTICLE 81")
    const articleMatch = data.text.match(/ARTICLE\s+(\d+)/i);
    if (!articleMatch) {
      this.logger.warn(
        "Could not detect 'ARTICLE {number}' header. Defaulting to broad scanning."
      );
    }
    const articleNumber = articleMatch ? articleMatch[1] : "\\d+";
    this.logger.log(
      `Detected Document Context: ARTICLE ${articleNumber === "\\d+" ? "(Unknown)" : articleNumber}`
    );

    // 2. Split text based on Article Codes.
    // Strictly look for patterns like "§{ArticleNumber}.XX" appearing at the start of a line.
    const splitRegex = new RegExp(`(?=(?:^|\\n)§${articleNumber}\\.\\d+)`, "g");

    const distinctSections = data.text.split(splitRegex);

    const articlesMap = new Map<
      string,
      { fullText: string; title: string | null }
    >();

    for (const rawSection of distinctSections) {
      // CLEANING STRATEGY:
      // We want to normalize whitespace but PRESERVE newlines to allow paragraph chunking.
      // 1. Replace multiple spaces/tabs with single space.
      // 2. Trim lines.
      // 3. Keep single newlines for structure (or double for paragraphs).

      const cleanText = rawSection
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0)
        .join("\n");

      // Must start with § to be a valid article
      if (!cleanText.startsWith("§")) continue;

      // Extract code from the clean text
      const codeMatch = cleanText.match(/^§\s*(\d+\.\d+)/);
      if (!codeMatch) continue;

      const code = codeMatch[1]; // e.g. "81.01"

      // Deduplication & TOC Strategy:
      // First occurrence is usually in the Table of Contents (TOC). We trust this Title.
      // Subsequent occurrences are the Article Body. We use this for fullText.

      if (!articlesMap.has(code)) {
        // --- TOC OCCURRENCE ---
        // Extract Title from TOC line e.g. "§ 81.01 Scope."
        // We want "Scope" (no dot)
        let title: string | null = null;
        const sameLineMatch = cleanText.match(/^§\s*\d+\.\d+\s+(.+)$/m);

        if (sameLineMatch) {
          title = sameLineMatch[1].trim();
          // Remove trailing dot if present
          if (title.endsWith(".")) {
            title = title.slice(0, -1);
          }
        } else {
          // Fallback if TOC entry is multiline (unlikely for TOC but possible)
          const lines = cleanText.split("\n");
          if (lines.length > 1 && !lines[1].trim().startsWith("§")) {
            title = lines[1].trim();
            if (title.endsWith(".")) {
              title = title.slice(0, -1);
            }
          }
        }

        // Initialize with Title from TOC, empty Body
        articlesMap.set(code, { fullText: "", title });
      } else {
        // --- BODY OCCURRENCE ---
        // We already have the entry from TOC. Now we populate fullText.
        // We want to STRIP the Header (Code + Title) from the body text.
        // The body usually starts with: § 81.01 Scope.\nActual content...

        // Find where the first line ends, or the header ends.
        // We'll assume the header is the first paragraph/line that matches the Code pattern.
        let bodyText = cleanText;

        // Regex to match the start "§ 81.01 [Title...]" up to the first newline or significant break
        // Actually, since we cleaned text, we can just split by newline and drop the first line if it looks like a header.
        const lines = cleanText.split("\n");
        if (lines.length > 0 && lines[0].includes(code)) {
          // Drop the first line (the header)
          bodyText = lines.slice(1).join("\n").trim();
        }

        const existing = articlesMap.get(code)!;
        // If we found a body that is longer than what we have (in case of dupes), save it.
        // Note: existing.fullText starts empty from TOC step.
        if (bodyText.length > existing.fullText.length) {
          articlesMap.set(code, { ...existing, fullText: bodyText });
        }
      }
    }

    this.logger.log(`Final unique articles to process: ${articlesMap.size}`);

    let count = 0;
    let chunksCount = 0;

    for (const [code, { fullText, title }] of articlesMap) {
      // 3. Create Parent Article
      // Title extraction is best-effort.
      // We store fullText for reference.
      const healthCode = await this.prisma.healthCode.upsert({
        where: { code },
        update: { fullText, title },
        create: {
          code,
          fullText,
          title,
        },
      });

      // 4. Create Chunks
      const rawChunks = fullText.split("\n");
      // Group small lines together to form meaningful chunks (~200+ chars)
      const mergedChunks: string[] = [];
      let currentChunk = "";

      for (const line of rawChunks) {
        if (currentChunk.length + line.length < 500) {
          currentChunk += (currentChunk ? " " : "") + line;
        } else {
          mergedChunks.push(currentChunk);
          currentChunk = line;
        }
      }
      if (currentChunk) mergedChunks.push(currentChunk);

      // Delete existing chunks to avoid duplication on re-run (or use checksums)
      // Ideally we'd sync, but deleting old chunks for this Article is safer/easier for now.
      await this.prisma.healthCodeChunk.deleteMany({
        where: { healthCodeId: healthCode.id },
      });

      for (const chunkContent of mergedChunks) {
        if (chunkContent.length < 20) continue; // Noise filter

        const embedding =
          await this.featureExtractionService.generateEmbedding(chunkContent);
        await this.prisma.healthCodeChunk.create({
          data: {
            content: chunkContent,
            embedding,
            healthCodeId: healthCode.id,
            code: healthCode.code,
          },
        });
        chunksCount++;
      }

      count++;
    }
    this.logger.log(
      `Processed ${count} Health Codes with ${chunksCount} chunks.`
    );
  }
}
