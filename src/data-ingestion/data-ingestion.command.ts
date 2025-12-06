import { Command, CommandRunner } from "nest-commander";
import { HealthCodeIngestionService } from "./health-code-ingestion.service";
import { ViolationIngestionService } from "./violation-ingestion.service";
import * as path from "path";

@Command({
  name: "load-data",
  description: "Ingest data from PDF and CSV files into MongoDB",
})
export class DataIngestionCommand extends CommandRunner {
  constructor(
    private readonly healthCodeIngestionService: HealthCodeIngestionService,
    private readonly violationIngestionService: ViolationIngestionService
  ) {
    super();
  }

  async run(passedParam: string[], options?: any): Promise<void> {
    console.log("Data Ingestion Command initiated...");

    // Default paths
    const dataDir = path.join(process.cwd(), "data");
    const pdfPath = path.join(dataDir, "health_code.pdf");
    const csvPath = path.join(dataDir, "inspections.csv");

    console.log("Step 1/2: Ingesting Health Code...");
    try {
      await this.healthCodeIngestionService.ingestHealthCode(pdfPath);
      console.log("✅ Health Code ingestion finished.");
    } catch (e) {
      console.error(
        "❌ Failed to ingest health code (check if files exist via setup instructions):",
        e.message
      );
    }

    console.log("Step 2/2: Ingesting Inspections...");
    try {
      await this.violationIngestionService.ingestInspections(csvPath);
      console.log("✅ Inspections ingestion finished.");
    } catch (e) {
      console.error("❌ Failed to ingest inspections:", e.message);
    }

    console.log("🎉 Seeding process complete.");
  }
}
