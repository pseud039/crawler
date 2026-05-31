import { PrismaClient, UserPlan, CrawlJobStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Create user
  const user = await prisma.user.upsert({
    where: {
      email: "demo@nexusseo.com",
    },
    update: {},
    create: {
      email: "demo@nexusseo.com",
      apiKey: "demo-api-key",
      plan: UserPlan.free,
    },
  });

  // Create crawl job
  const job = await prisma.crawlJob.create({
    data: {
      userId: user.id,
      name: "Prisma Seed Crawl",
      status: CrawlJobStatus.pending,

      config: {
        allowSubdomains: true,
        respectRobotsTxt: true,
      },

      seedUrls: [
        "https://example.com",
        "https://developer.mozilla.org",
      ],

      depth: 2,
      maxPages: 100,
    },
  });

  console.log("Created Job:", job.id);

  // Add URLs to frontier
  await prisma.frontierUrl.createMany({
    data: [
      {
        jobId: job.id,
        url: "https://example.com",
        depth: 0,
        priority: 1,
      },
      {
        jobId: job.id,
        url: "https://developer.mozilla.org",
        depth: 0,
        priority: 1,
      },
    ],
  });

  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });