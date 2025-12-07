import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { FeatureExtractionService } from "./feature-extraction.service";
import * as fs from "fs";
import csv from "csv-parser";

@Injectable()
export class ViolationIngestionService {
  private readonly logger = new Logger(ViolationIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureExtractionService: FeatureExtractionService
  ) {}

  async ingestInspections(filePath: string) {
    this.logger.log(`Parsing Inspections CSV from: ${filePath}`);

    // Find UNIQUE violation descriptions
    const uniqueViolations = new Map<
      string,
      { code: string; description: string }
    >(); // uniqueKey -> { code, description }

    const stream = fs.createReadStream(filePath).pipe(csv());

    for await (const data of stream) {
      // Adjust field names based on actual CSV header.
      // Assuming "VIOLATION CODE" and "VIOLATION DESCRIPTION" based on NYC Open Data
      const code = data["VIOLATION CODE"];
      const description = data["VIOLATION DESCRIPTION"];

      if (code && description) {
        // Create a unique key for deduplication based on both fields
        const key = `${code}|${description}`;
        if (!uniqueViolations.has(key)) {
          uniqueViolations.set(key, { code, description });
        }
      }
    }

    this.logger.log(
      `Found ${uniqueViolations.size} unique violations. Generating embeddings...`
    );

    let count = 0;
    for (const { code, description } of uniqueViolations.values()) {
      const embedding =
        await this.featureExtractionService.generateEmbedding(description);

      // Using composite key logic or just upserting by code+description unique constraint if possible

      await this.prisma.violation.upsert({
        where: {
          code_description: { code, description },
        },
        update: { embedding }, // Update embedding if exists
        create: { code, description, embedding },
      });
      count++;
      if (count % 10 === 0) this.logger.log(`Processed ${count} violations...`);
    }

    this.logger.log(`Ingestion complete. Processed ${count} violations.`);
    return true;
  }
}
