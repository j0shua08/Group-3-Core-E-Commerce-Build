// server/prisma.config.ts
import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";



// If you place .env inside server/prisma/.env instead, use:
config({ path: "./prisma/.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL"), // reads from the .env we just loaded
  },
});
