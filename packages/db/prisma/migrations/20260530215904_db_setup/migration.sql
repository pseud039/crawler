-- CreateEnum
CREATE TYPE "UserPlan" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "CrawlJobStatus" AS ENUM ('pending', 'running', 'paused', 'done', 'failed');

-- CreateEnum
CREATE TYPE "FrontierUrlStatus" AS ENUM ('queued', 'leased', 'crawled', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "plan" "UserPlan" NOT NULL DEFAULT 'free',
    "quota_urls" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT,
    "status" "CrawlJobStatus" NOT NULL DEFAULT 'pending',
    "config" JSONB NOT NULL,
    "seed_urls" TEXT[],
    "depth" INTEGER NOT NULL DEFAULT 2,
    "max_pages" INTEGER NOT NULL DEFAULT 500,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_pages" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "blob_url" TEXT NOT NULL,
    "http_status" INTEGER,
    "headers" JSONB,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byte_size" INTEGER,

    CONSTRAINT "raw_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_results" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "raw_page_id" UUID NOT NULL,
    "component_type" TEXT NOT NULL,
    "derived_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "derived_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "frontier_urls" (
    "id" SERIAL NOT NULL,
    "job_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" "FrontierUrlStatus" NOT NULL DEFAULT 'queued',
    "added_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crawled_at" TIMESTAMPTZ,
    "lease_until" TIMESTAMPTZ,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "frontier_urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_stats" (
    "job_id" UUID NOT NULL,
    "urls_crawled" INTEGER NOT NULL DEFAULT 0,
    "urls_queued" INTEGER NOT NULL DEFAULT 0,
    "urls_failed" INTEGER NOT NULL DEFAULT 0,
    "bytes_fetched" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_stats_pkey" PRIMARY KEY ("job_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_api_key_key" ON "users"("api_key");

-- CreateIndex
CREATE INDEX "crawl_jobs_user_id_idx" ON "crawl_jobs"("user_id");

-- CreateIndex
CREATE INDEX "crawl_jobs_status_idx" ON "crawl_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "raw_pages_content_hash_key" ON "raw_pages"("content_hash");

-- CreateIndex
CREATE INDEX "raw_pages_url_idx" ON "raw_pages"("url");

-- CreateIndex
CREATE INDEX "derived_results_job_id_idx" ON "derived_results"("job_id");

-- CreateIndex
CREATE INDEX "derived_results_job_id_component_type_idx" ON "derived_results"("job_id", "component_type");

-- CreateIndex
CREATE INDEX "frontier_urls_job_id_status_idx" ON "frontier_urls"("job_id", "status");

-- CreateIndex
CREATE INDEX "frontier_urls_lease_until_idx" ON "frontier_urls"("lease_until");

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derived_results" ADD CONSTRAINT "derived_results_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derived_results" ADD CONSTRAINT "derived_results_raw_page_id_fkey" FOREIGN KEY ("raw_page_id") REFERENCES "raw_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "frontier_urls" ADD CONSTRAINT "frontier_urls_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stats" ADD CONSTRAINT "job_stats_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "crawl_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
