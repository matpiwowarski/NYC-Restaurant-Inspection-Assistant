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

    const articlesMap = new Map<string, string>();

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

      // Basic Title Extraction (line after code or same line)
      // § 81.01 Scope.
      let title = null;
      const titleMatch = cleanText.match(/^§\s*\d+\.\d+\s+(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // Deduplication: keep longest version
      if (articlesMap.has(code)) {
        const existing = articlesMap.get(code) || "";
        if (cleanText.length > existing.length) {
          articlesMap.set(code, cleanText);
        }
      } else {
        articlesMap.set(code, cleanText);
      }
    }

    this.logger.log(`Final unique articles to process: ${articlesMap.size}`);

    let count = 0;
    let chunksCount = 0;

    for (const [code, fullText] of articlesMap) {
      // 3. Create Parent Article
      // Title extraction is best-effort.
      // We store fullText for reference.
      const healthCode = await this.prisma.healthCode.upsert({
        where: { code },
        update: { fullText },
        create: {
          code,
          fullText,
          title: null, // Populated if we extracted properly, otherwise null or update logic
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
