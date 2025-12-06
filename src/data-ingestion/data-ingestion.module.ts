import { Module } from "@nestjs/common";
import { DataIngestionService } from "./data-ingestion.service";
import { PrismaModule } from "../prisma/prisma.module";

@Module({
  imports: [PrismaModule],
  providers: [DataIngestionService],
})
export class DataIngestionModule {}
