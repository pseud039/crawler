import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export { CrawlJobStatus, FrontierUrlStatus, UserPlan } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({
  adapter,
  log: ["query"],
});