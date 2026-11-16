import { storage } from '../setup.js';

await storage.removeAtoms(['posts/hello-world']).collect();
