import "dotenv/config";
import "reflect-metadata";

async function bootstrap(): Promise<void> {
  const { NestFactory } = await import("@nestjs/core");
  const { ValidationPipe, Logger } = await import("@nestjs/common");
  const { AppModule } = await import("./app.module");

  const app = await NestFactory.create(AppModule, { cors: false });
  app.enableCors({
    origin: (process.env.OPENREEL_CORS ?? "http://localhost:5173").split(","),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });
  app.setGlobalPrefix("api", { exclude: [] });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`OpenReel server listening on http://localhost:${port}/api`, "Bootstrap");
}

void bootstrap();
