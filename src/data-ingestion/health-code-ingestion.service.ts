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

    // Convert to single line by replacing newlines with spaces
    const fullText = pdfData.text.replace(/\n/g, " ");

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

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const nextSection = sections[i + 1]; // undefined for the last section

      const content = this.parsingService.extractSectionContent(
        fullText,
        section,
        nextSection
      );

      await this.prisma.healthCode.upsert({
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
    }

    this.logger.log(`Successfully processed ${sections.length} sections.`);
  }
}
