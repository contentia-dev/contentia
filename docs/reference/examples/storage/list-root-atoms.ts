import { storage } from '../setup.js';

await storage.listAtoms('', {
  depth: 1,
  pagination: { perPage: 100 },
}).collect();
