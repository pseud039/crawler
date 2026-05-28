import { createHash } from 'crypto'
import { db } from './prisma.js'
import { blob } from './blob.js'

export async function storeRawPage(data: {
  url: string
  html: string
  statusCode: number
  headers: Record<string, string>
  fetchedAt: Date
}): Promise<string> {

  const contentHash = createHash('sha256')
    .update(data.html)
    .digest('hex')

  // already stored by someone? reuse it
  const existing = await db.rawPage.findUnique({
    where: { contentHash }
  })

  if (existing) return existing.id
   
  // new content — write to blob first, then metadata row
  const blobKey = `pages/${contentHash}.html`
  await blob.put(blobKey, data.html)

  const rawPage = await db.rawPage.create({
    data: {
      url: data.url,
      contentHash,
      blobUrl: blobKey,
      httpStatus: data.statusCode,
      headers: data.headers,
      fetchedAt: data.fetchedAt,
      byteSize: Buffer.byteLength(data.html, 'utf-8')
    }
  })

  return rawPage.id
}

export async function storeDerivedResult(data: {
  jobId: string
  rawPageId: string
  componentType: string
  derivedData: Record<string, any>
}): Promise<void> {

  await db.derivedResult.create({
    data: {
      jobId: data.jobId,
      rawPageId: data.rawPageId,
      componentType: data.componentType,
      derivedData: data.derivedData
    }
  })

  await db.jobStat.update({
    where: { jobId: data.jobId },
    data: { urlsCrawled: { increment: 1 } }
  })
}