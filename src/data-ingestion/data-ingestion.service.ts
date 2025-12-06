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
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
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
      // Strategy: Split by double newline (paragraphs) first.
      // If that's too coarse, we can split by newline.
      // Given we joined with `\n` above, we will treat `\n` as specific break points.
      // Let's try to group lines into reasonable chunks (~100-300 chars min?).
      // For now, simpler: Split by explicit section headers or paragraphs if we had double newlines.
      // Since we utilized `join("\n")`, every line is a potential semantic unit.
      // Let's rely on semantic grouping: Paragraphs often have multiple lines.
      // But PDF parsing makes detecting params hard.
      // We will treat every block of text separated by "Header-like" casing or numbering as a chunk?
      // SIMPLEST ROBUST START: Overlap window of lines or just split by `\n` if lines are long enough.
      // LET'S DO: Split by `\n` (which were original non-empty lines).
      // Concatenate lines until we hit a length threshold (e.g. 500 chars) OR a recognizable list item?
      // ACTUALLY: The user suggestion implies semantic comparison.
      // Let's split by double newlines if we preserved them? We didn't. We did `filter(length > 0)`.
      // So `cleanText` is a dense block of lines.

      // BETTER PARSING:
      // Re-read section: `rawSection`.
      // If we use `replace(/\r\n/g, "\n")` and split by `\n\n`, we effectively get paragraphs.
      // So let's re-parse `cleanText` slightly differently in the loop above?
      // Actually, let's just chunk the `fullText` we have now.
      // We will split by `\n` but try to group them.

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

        const embedding = await this.generateEmbedding(chunkContent);
        await this.prisma.healthCodeChunk.create({
          data: {
            content: chunkContent,
            embedding,
            healthCodeId: healthCode.id,
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
      if (count % 10 === 0) this.logger.log(`Processed ${count} violations...`);
    }

    this.logger.log(`Ingestion complete. Processed ${count} violations.`);
    return true;
  }
}
