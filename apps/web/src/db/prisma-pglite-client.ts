import type { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@row-chat/pglite-db/edge';
import { connectPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import PgliteSharedWorker from './prisma-pglite-shared-worker.ts?sharedworker';

const pglite = connectPgliteSharedWorker(PgliteSharedWorker);
// `PrismaPGlite` is typed against the concrete `PGlite` class; `PGliteWorker`
// only implements `PGliteInterface`. They're functionally interchangeable here.
const adapter = new PrismaPGlite(pglite as unknown as PGlite);

const prisma = new PrismaClient({ adapter });
export default prisma;
