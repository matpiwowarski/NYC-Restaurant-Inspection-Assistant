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

    // 1. Detect the main Chapter Number from the document header (e.g. "ARTICLE 81")
    const headerMatch = data.text.match(/ARTICLE\s+(\d+)/i);
    if (!headerMatch) {
      this.logger.warn(
        "Could not detect 'ARTICLE {number}' header. Defaulting to broad scanning."
      );
    }
    const chapterNumber = headerMatch ? headerMatch[1] : "\\d+";
    this.logger.log(
      `Detected Document Context: ARTICLE ${chapterNumber === "\\d+" ? "(Unknown)" : chapterNumber}`
    );

    // 2. Flatten Text Strategy
    // Remove all newlines and extra spaces to treat the document as a continuous stream.
    const flattenedText = data.text.replace(/\s+/g, " ").trim();

    // 3. Split based on Section Codes
    // Pattern: Lookahead for "§ {ChapterNumber}.XX" (allowing optional space after §)
    const splitRegex = new RegExp(`(?=§\\s*${chapterNumber}\\.\\d+)`, "g");
    const distinctSections = flattenedText.split(splitRegex);

    this.logger.log(`Found ${distinctSections.length} potential sections.`);

    const validSections: {
      code: string;
      title: string;
      fullText: string;
    }[] = [];

    for (const section of distinctSections) {
      if (!section.trim().startsWith("§")) continue;

      // Extract Code
      // Explanation:
      // ^      : Start of string
      // §      : Literal section symbol
      // \s*    : Optional whitespace
      // (\d+\.\d+) : Capture group for digits dot digits (e.g., 81.05)
      const codeMatch = section.match(/^§\s*(\d+\.\d+)/);
      if (!codeMatch) continue;

      const code = codeMatch[1];

      // We want to separate Title and Body.
      // Strategy: Title is everything from the code end up to the FIRST period.
      // Body is everything after that period.

      const afterCodeIndex = codeMatch[0].length;
      const restOfText = section.substring(afterCodeIndex).trim();

      const firstDotIndex = restOfText.indexOf(".");

      let title = "";
      let body = "";

      if (firstDotIndex === -1) {
        // Fallback: No dot found, entire text is title (likely a TOC entry or misformatted)
        title = restOfText;
        body = "";
      } else {
        title = restOfText.substring(0, firstDotIndex).trim();
        body = restOfText.substring(firstDotIndex + 1).trim();
      }

      // Filter out empty bodies if they are just TOC entries?
      // Actually, if we have duplicate codes (one TOC, one Real), we want the Real one (with Body).
      // Or we want to merge?
      // User's request implied simplicity. Let's process valid ones.

      // Deduplication: prefer entry with longer body (likely the real section, not TOC)
      const existingIndex = validSections.findIndex((a) => a.code === code);
      if (existingIndex !== -1) {
        if (body.length > validSections[existingIndex].fullText.length) {
          // Replace with this one as it seems to be the main content
          validSections[existingIndex] = { code, title, fullText: body };
        }
      } else {
        validSections.push({ code, title, fullText: body });
      }
    }

    this.logger.log(
      `Final unique sections to process: ${validSections.length}`
    );

    let count = 0;
    let chunksCount = 0;

    for (const { code, fullText, title } of validSections) {
      // 4. Create Parent Health Code Entry
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

      // 5. Create Chunks
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
      // Ideally we'd sync, but deleting old chunks for this Section is safer/easier for now.
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
