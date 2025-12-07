import { Command, CommandRunner } from "nest-commander";
import { Logger } from "@nestjs/common";
import { HealthCodeIngestionService } from "./health-code-ingestion.service";
import { ViolationIngestionService } from "./violation-ingestion.service";
import * as path from "path";

@Command({
  name: "load-data",
  description: "Ingest data from PDF and CSV files into MongoDB",
})
export class DataIngestionCommand extends CommandRunner {
  private readonly logger = new Logger(DataIngestionCommand.name);

  constructor(
    private readonly healthCodeIngestionService: HealthCodeIngestionService,
    private readonly violationIngestionService: ViolationIngestionService
  ) {
    super();
  }

  async run(passedParam: string[], options?: any): Promise<void> {
    this.logger.log("Data Ingestion Command initiated...");

    // Default paths
    const dataDir = path.join(process.cwd(), "data");
    const pdfPath = path.join(dataDir, "health_code.pdf");
    const csvPath = path.join(dataDir, "inspections.csv");

    this.logger.log("Step 1/2: Ingesting Health Code...");
    try {
      await this.healthCodeIngestionService.ingestHealthCode(pdfPath);
      this.logger.log("✅ Health Code ingestion finished.");
    } catch (e) {
      this.logger.error(
        "❌ Failed to ingest health code (check if files exist via setup instructions): " +
          (e as Error).message
      );
    }

    this.logger.log("Step 2/2: Ingesting Inspections...");
    try {
      await this.violationIngestionService.ingestInspections(csvPath);
      this.logger.log("✅ Inspections ingestion finished.");
    } catch (e) {
      this.logger.error(
        "❌ Failed to ingest inspections: " + (e as Error).message
      );
    }

    this.logger.log("🎉 Seeding process complete.");
  }
}
