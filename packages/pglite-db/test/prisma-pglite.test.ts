import { defineChinookSuite } from './chinook-suite.ts';
import { createTestClient } from './prisma-pglite-test-client.ts';

defineChinookSuite('prisma-pglite', createTestClient);
