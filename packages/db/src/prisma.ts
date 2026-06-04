import { PrismaClient } from "@prisma/client";
export { CrawlJobStatus, FrontierUrlStatus, UserPlan } from '@prisma/client'

export const db = new PrismaClient({
  log: ["query"],
});