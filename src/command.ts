import { CommandFactory } from "nest-commander";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  try {
    await CommandFactory.run(AppModule, {
      logger: ["error", "warn", "log", "debug"],
    });
    Logger.log("Command finished!", "Bootstrap");
    process.exit(0);
  } catch (err) {
    Logger.error("Error during command execution:", err, "Bootstrap");
    process.exit(1);
  }
}

bootstrap();
