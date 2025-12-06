/// <reference path="../types.d.ts" />
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs";
import pdf from "pdf-parse";
import csv from "csv-parser";

@Injectable()
export class DataIngestionService implements OnModuleInit {
  private readonly logger = new Logger(DataIngestionService.name);
  private extractor: any;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("Initializing Feature Extraction Model...");
    // Dynamic import for ESM-only package
    const { pipeline } = await import("@xenova/transformers");

    // Use a small, efficient model suitable for semantic similarity
    this.extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    this.logger.log("Model initialized.");
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!text) return [];
    // Generate embedding
    const output = await this.extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    // Convert Tensor to standard array
    return Array.from(output.data);
  }

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
    const articleNumber = articleMatch ? articleMatch[1] : "\\d+"; // Default to any digits if not found
    this.logger.log(
      `Detected Document Context: ARTICLE ${articleNumber === "\\d+" ? "(Unknown)" : articleNumber}`
    );

    // 2. Split text based on Article Codes.
    // Strictly look for patterns like "§{ArticleNumber}.XX" appearing at the start of a line.
    // Use a Lookahead (?=...) to split *before* the pattern, keeping the header in the new chunk.
    const splitRegex = new RegExp(`(?=(?:^|\\n)§${articleNumber}\\.\\d+)`, "g");

    // Split the entire text
    const distinctSections = data.text.split(splitRegex);

    // Verify valid articles after splitting.
    const validSections = distinctSections.filter((s) => {
      const trimmed = s.trim();
      // Must start with §
      return trimmed.startsWith("§");
    });

    this.logger.log(
      `Found ${validSections.length} potential text blocks starting with §. Deduplicating...`
    );

    // Map to store unique articles by code.
    // If a code appears multiple times (e.g. in TOC and Body), keep the longest text.
    const articlesMap = new Map<string, string>();

    for (const sectionText of validSections) {
      // Extract code again from the chunk itself
      const codeMatch = sectionText.match(/^§\s*(\d+\.\d+)/);
      if (!codeMatch) continue;

      const code = codeMatch[1];
      // Clean text:
      // 1. Remove page numbers (isolated digits) if any
      // 2. Collapse whitespace
      const cleanText = sectionText.replace(/\s+/g, " ").trim();

      if (articlesMap.has(code)) {
        // If this code already exists, keep the longer version (e.g. real article vs TOC summary)
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
    for (const [code, text] of articlesMap) {
      const embedding = await this.generateEmbedding(text);

      await this.prisma.healthCodeArticle.upsert({
        where: { code },
        update: { text, embedding },
        create: { code, text, embedding },
      });
      count++;
    }
    this.logger.log(`Processed ${count} Health Code articles.`);
  }

  async ingestInspections(filePath: string) {
    this.logger.log(`Parsing Inspections CSV from: ${filePath}`);
    const results = [];

    // Find UNIQUE violation descriptions
    const uniqueViolations = new Map<string, string>(); // code -> description

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data: any) => {
          // Adjust field names based on actual CSV header.
          // Assuming "VIOLATION CODE" and "VIOLATION DESCRIPTION" based on NYC Open Data
          const code = data["VIOLATION CODE"];
          const description = data["VIOLATION DESCRIPTION"];

          if (code && description) {
            uniqueViolations.set(code, description);
          }
        })
        .on("end", async () => {
          this.logger.log(
            `Found ${uniqueViolations.size} unique violations. Generating embeddings...`
          );

          let count = 0;
          for (const [code, description] of uniqueViolations) {
            const embedding = await this.generateEmbedding(description);

            // Using composite key logic or just upserting by code+description unique constraint if possible
            // However, our schema currently only has Code unique in HealthArticle, but Violation has @@unique([code, description])

            await this.prisma.violation.upsert({
              where: {
                code_description: { code, description },
              },
              update: { embedding }, // Update embedding if exists
              create: { code, description, embedding },
            });
            count++;
            if (count % 10 === 0)
              this.logger.log(`Processed ${count} violations...`);
          }

          this.logger.log(`Ingestion complete. Processed ${count} violations.`);
          resolve(true);
        })
        .on("error", (err: any) => reject(err));
    });
  }
}
