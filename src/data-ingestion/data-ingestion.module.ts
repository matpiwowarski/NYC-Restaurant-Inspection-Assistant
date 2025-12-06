import { Module } from "@nestjs/common";
import { DataIngestionService } from "./data-ingestion.service";
import { PrismaModule } from "../prisma/prisma.module";
import { DataIngestionCommand } from "./data-ingestion.command";

@Module({
  imports: [PrismaModule],
  providers: [DataIngestionService, DataIngestionCommand],
})
export class DataIngestionModule {}
