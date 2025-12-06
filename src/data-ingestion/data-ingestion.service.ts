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

    // 1. Extract TOC (Table of Contents) to identify valid Article Codes.
    // We assume the TOC is at the beginning and lists articles in the format "§81.XX Title".
    // We strictly look for the pattern "§{Digits}.{Digits}" (e.g., §81.04).
    const tocRegex = /§(\d+\.\d+)/g;
    const tocMatches = [...data.text.matchAll(tocRegex)];

    // Extract unique codes from the first few matches.
    // In a full PDF, these codes might appear many times. The TOC is usually the first cluster.
    // We'll trust all "§XX.XX" patterns found as potential split points,
    // BUT we will verify they act as Headers (followed by title/newline) later.
    const allCodes = tocMatches.map((m) => m[1]);
    const uniqueCodes = Array.from(new Set(allCodes));

    this.logger.log(
      `Identified ${uniqueCodes.length} unique article codes from text scanning.`
    );

    // 2. Build a specific Regex to split ONLY on these known codes.
    // Pattern: Lookahead for "§" followed by one of our codes, ensuring it starts a line or block.
    // We escape the dots in codes.
    const codesPattern = uniqueCodes
      .map((c) => c.replace(".", "\\."))
      .join("|");
    // Regex explanation:
    // (?=...) is a lookahead (don't consume the split delimiter, just find the position)
    // §\s*(${codesPattern}) matches §81.01, § 81.04 etc.
    const splitRegex = new RegExp(`(?=§\\s*(?:${codesPattern}))`, "g");

    // Split the entire text
    const distinctSections = data.text.split(splitRegex);

    // Filter out chunks that are too short to be real articles (e.g. noise, intro text)
    // And ensure the chunk actually STARTS with the expected pattern (to confirm it's an article content)
    const validSections = distinctSections.filter((s) => {
      const trimmed = s.trim();
      // Must start with § and be reasonably long
      return trimmed.startsWith("§") && trimmed.length > 50;
    });

    this.logger.log(
      `Found ${validSections.length} valid articles after splitting. Processing...`
    );

    let count = 0;
    for (const sectionText of validSections) {
      // Extract code again from the chunk itself
      const codeMatch = sectionText.match(/^§\s*(\d+\.\d+)/);
      if (!codeMatch) continue;

      const code = codeMatch[1];

      // Clean text:
      // 1. Remove page numbers (isolated digits) if any
      // 2. Collapse whitespace
      const cleanText = sectionText.replace(/\s+/g, " ").trim();

      const embedding = await this.generateEmbedding(cleanText);

      await this.prisma.healthCodeArticle.upsert({
        where: { code },
        update: { text: cleanText, embedding },
        create: { code, text: cleanText, embedding },
      });
      count++;
    }
    this.logger.log(`Processed ${count} Health Code articles.`);
  }

  async ingestInspections(filePath: string) {
    this.logger.log(`Parsing Inspections CSV from: ${filePath}`);
    const results = [];

    // We want to find UNIQUE violation descriptions
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
