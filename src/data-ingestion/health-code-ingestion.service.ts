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

    // Flatten text
    const flattenedText = this.parsingService.flattenText(data.text);

    // Split sections
    const distinctSections = this.parsingService.splitSections(
      flattenedText,
      chapterNumber
    );

    this.logger.log(`Found ${distinctSections.length} potential sections.`);

    const validSections: {
      code: string;
      title: string;
      fullText: string;
    }[] = [];

    for (const section of distinctSections) {
      const parsed = this.parsingService.parseSection(section);
      if (!parsed) continue;

      const { code, title, body } = parsed;

      // Deduplication
      const existingIndex = validSections.findIndex((a) => a.code === code);
      if (existingIndex !== -1) {
        if (body.length > validSections[existingIndex].fullText.length) {
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
        if (chunkContent.length < 5) continue; // Noise filter (reduced from 20)

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
