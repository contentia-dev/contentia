import { storage } from '../setup.js';

await storage.createObject({
  key: 'posts/hello-world',
  content: {
    title: 'Hello world',
    body: 'My first post.',
  },
});
