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
    const pdfData = await pdf(dataBuffer);

    // Keep raw text to preserve newlines for parsing
    let fullText = pdfData.text;

    // Normalize section headers: remove space between § and number (e.g. "§ 81" -> "§81")
    fullText = fullText.replace(/§\s+(\d)/g, "§$1");

    const articleCode = this.parsingService.extractArticleCode(fullText);

    if (!articleCode) {
      this.logger.error("Could not extract Article Code from PDF.");
      return;
    }

    this.logger.log(`Found Article Code: ${articleCode}`);

    // Extract sections (e.g. 81.01, 81.03) based on the Article Code
    const sections = this.parsingService.extractSections(fullText, articleCode);
    this.logger.log(
      `Found ${sections.length} sections for Article ${articleCode}.`
    );

    // Remove Table of Contents (first occurrences of headers)
    for (const section of sections) {
      if (section.rawMatch) {
        fullText = this.parsingService.removeSectionHeader(
          fullText,
          section.rawMatch
        );
      }
    }

    // Extract content destructively
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const nextSection = sections[i + 1];

      const { content, remainingText } =
        this.parsingService.extractContentByCode(
          fullText,
          section.code,
          nextSection?.code
        );

      // Update fullText with the text remaining after extraction
      fullText = remainingText;

      const healthCodeRecord = await this.prisma.healthCode.upsert({
        where: { code: section.code },
        update: {
          fullText: content,
          title: section.title,
        },
        create: {
          code: section.code,
          fullText: content,
          title: section.title,
        },
      });

      // Clear existing chunks to avoid duplicates
      await this.prisma.healthCodeChunk.deleteMany({
        where: { healthCodeId: healthCodeRecord.id },
      });

      // Create chunks for the section
      const sentences = this.parsingService.splitIntoSentences(content);
      for (const sentence of sentences) {
        if (!sentence.trim()) continue;

        const embedding =
          await this.featureExtractionService.generateEmbedding(sentence);

        await this.prisma.healthCodeChunk.create({
          data: {
            content: sentence,
            embedding: embedding,
            code: section.code,
            healthCodeId: healthCodeRecord.id,
          },
        });
      }
    }

    this.logger.log(`Successfully processed ${sections.length} sections.`);
    this.logger.log(`Remaining text after ingestion: "${fullText.trim()}"`);
  }
}
