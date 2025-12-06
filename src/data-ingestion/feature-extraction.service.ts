import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

@Injectable()
export class FeatureExtractionService implements OnModuleInit {
  private readonly logger = new Logger(FeatureExtractionService.name);
  private extractor: any;

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
}
