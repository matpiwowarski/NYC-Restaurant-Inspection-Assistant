import { Module } from "@nestjs/common";
import { FeatureExtractionService } from "./feature-extraction.service";
import { HealthCodeIngestionService } from "./health-code-ingestion.service";
import { ViolationIngestionService } from "./violation-ingestion.service";
import { PrismaModule } from "../prisma/prisma.module";
import { DataIngestionCommand } from "./data-ingestion.command";

@Module({
  imports: [PrismaModule],
  providers: [
    DataIngestionCommand,
    FeatureExtractionService,
    HealthCodeIngestionService,
    ViolationIngestionService,
  ],
})
export class DataIngestionModule {}
