import { startPgliteSharedWorker } from '@row-chat/prisma-pglite-adapter/shared-worker';
import { createPglite } from './pglite';

startPgliteSharedWorker({ createPglite });
