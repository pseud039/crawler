import { QdrantClient } from '@qdrant/js-client-rest';

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

const COLLECTION = process.env.QDRANT_COLLECTION ?? 'crawlkit';

export async function ensureCollection(): Promise<void> {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some(c => c.name === COLLECTION);

  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: {
        size: 1536, // text-embedding-3-small dimensions
        distance: 'Cosine',
      },
    });
    console.log(`[qdrant] created collection: ${COLLECTION}`);
  }
}

// Push a single derived result's embedding to Qdrant
export async function pushVector(
  id: string,
  vector: number[],
  payload: Record<string, any>
): Promise<void> {
  await qdrant.upsert(COLLECTION, {
    points: [{ id, vector, payload }],
  });
}