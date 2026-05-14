import { defineChinookSuite } from './chinook-suite.ts';
import { createTestClient } from './prisma-wa-sqlite-test-client.ts';

defineChinookSuite('prisma-wa-sqlite', createTestClient);
