import { storage } from '../setup.js';

await storage.listAtomSummaries('posts', {
  depth: 2,
  pagination: { perPage: 100 },
}).collect();
