import { storage } from '../setup.js';

await storage.listAtoms('posts', {
  depth: 2,
  pagination: { perPage: 100 },
}).collect();
