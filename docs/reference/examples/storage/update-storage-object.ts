import { storage } from '../setup.js';

await storage.updateObject({
  key: 'posts/hello-world',
  content: {
    title: 'Hello again',
    body: 'My first post, edited.',
  },
});
