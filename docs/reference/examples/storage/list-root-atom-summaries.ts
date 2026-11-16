import { storage } from '../setup.js';

await storage.listAtomSummaries('', {
  depth: 1,
  pagination: { perPage: 100 },
}).collect();
