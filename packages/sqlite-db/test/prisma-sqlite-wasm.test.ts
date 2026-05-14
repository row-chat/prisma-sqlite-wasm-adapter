import { defineChinookSuite } from './chinook-suite.ts';
import { createTestClient } from './prisma-sqlite-wasm-test-client.ts';

defineChinookSuite('prisma-sqlite-wasm', createTestClient);
