import type { PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '../prisma/generated/client/index.js';
import { createPglite } from '../scripts/pglite.ts';

export type TestClient = {
  prisma: PrismaClient;
  dispose: () => Promise<void>;
};

export async function createTestClient(): Promise<TestClient> {
  const pglite = await createPglite();
  // `PrismaPGlite` accepts the concrete `PGlite` class; the runtime
  // surface is identical so the cast is safe.
  const adapter = new PrismaPGlite(pglite as PGlite);
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    async dispose() {
      await prisma.$disconnect();
      await pglite.close();
    },
  };
}
