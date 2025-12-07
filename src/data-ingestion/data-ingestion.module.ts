import { Module } from "@nestjs/common";
import { DataIngestionCommand } from "./data-ingestion.command";
import { FeatureExtractionService } from "./feature-extraction.service";
import { PrismaModule } from "../prisma/prisma.module";
import { HealthCodeIngestionService } from "./health-code-ingestion.service";
import { ViolationIngestionService } from "./violation-ingestion.service";
import { HealthCodeParsingService } from "./health-code-parsing.service";

@Module({
  imports: [PrismaModule],
  providers: [
    DataIngestionCommand,
    FeatureExtractionService,
    HealthCodeIngestionService,
    ViolationIngestionService,
    HealthCodeParsingService,
  ],
  exports: [HealthCodeIngestionService, ViolationIngestionService],
})
export class DataIngestionModule {}
