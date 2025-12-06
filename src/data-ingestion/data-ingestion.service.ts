import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import * as fs from "fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require("pdf-parse");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const csv = require("csv-parser");
import { pipeline } from "@xenova/transformers";

@Injectable()
export class DataIngestionService implements OnModuleInit {
  private readonly logger = new Logger(DataIngestionService.name);
  private extractor: any;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.logger.log("Initializing Feature Extraction Model...");
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

    // Simple splitting strategy: Split by "§" (Section symbol) as it usually denotes articles in legal texts
    // This is a naive heuristic; might need adjustment based on actual PDF content.
    const sections = data.text.split("§").filter((s) => s.trim().length > 20);

    this.logger.log(
      `Found ${sections.length} potential articles. Processing...`
    );

    let count = 0;
    for (const sectionText of sections) {
      // Extract a code (e.g., "81.09") from the start of the text
      const codeMatch = sectionText.match(/^(\s*\d+\.\d+[a-z]?)/);
      const code = codeMatch ? codeMatch[1].trim() : `UNKNOWN_${count}`;

      // Clean text
      const cleanText = `§${sectionText}`.replace(/\s+/g, " ").trim();

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
