/// <reference path="../types.d.ts" />
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FeatureExtractionService } from "./feature-extraction.service";
import * as fs from "fs";
import pdf from "pdf-parse";
import { HealthCodeParsingService } from "./health-code-parsing.service";

@Injectable()
export class HealthCodeIngestionService {
  private readonly logger = new Logger(HealthCodeIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureExtractionService: FeatureExtractionService,
    private readonly parsingService: HealthCodeParsingService
  ) {}

  async ingestHealthCode(filePath: string) {
    this.logger.log(`Parsing Health Code PDF from: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);

    // Detect main chapter number
    const chapterNumber = this.parsingService.extractChapterNumber(data.text);
    this.logger.log(
      `Detected Document Context: ARTICLE ${chapterNumber === "\\d+" ? "(Unknown)" : chapterNumber}`
    );

    // Flatten text first (Stream-based approach)
    const flattenedText = this.parsingService.flattenText(data.text);

    // 1. Extract TOC from the flattened stream
    const { entries: tocEntries, bodyStartIndex } =
      this.parsingService.extractTableOfContents(flattenedText, chapterNumber);

    this.logger.log(
      `Extracted TOC with ${tocEntries.length} sections. Body starts at index ${bodyStartIndex}.`
    );

    if (tocEntries.length === 0) {
      this.logger.error("Failed to extract Table of Contents. Aborting.");
      return;
    }

    // 2. Strict split using TOC entries
    const validSections = this.parsingService.splitFullTextByTOC(
      flattenedText,
      tocEntries
    );

    this.logger.log(
      `final unique sections to process: ${validSections.length}`
    );

    let count = 0;
    let chunksCount = 0;

    for (const section of validSections) {
      const { code, fullText = "", title } = section;

      // Create parent entry
      const healthCode = await this.prisma.healthCode.upsert({
        where: { code },
        update: { fullText, title },
        create: {
          code,
          fullText,
          title,
        },
      });

      // Create chunks
      const mergedChunks = this.parsingService.chunkTextBySentence(fullText);

      // Reset chunks
      await this.prisma.healthCodeChunk.deleteMany({
        where: { healthCodeId: healthCode.id },
      });

      for (const chunkContent of mergedChunks) {
        if (chunkContent.length < 5) continue; // Noise filter

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
