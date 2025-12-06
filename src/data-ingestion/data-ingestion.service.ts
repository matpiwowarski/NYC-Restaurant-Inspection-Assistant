import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DataIngestionService {
  private readonly logger = new Logger(DataIngestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // For manual testing, we might call ingestion methods here or expose them via CLI/Controller
    this.logger.log("DataIngestionService initialized");
  }

  // TODO: Implement parsing logic
}
