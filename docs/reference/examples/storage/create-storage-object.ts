import { storage } from '../setup.js';

await storage.createObject({
  key: 'pages/about',
  content: {
    title: 'About',
    body: 'About this site.',
  },
});
