/**
 * Content collections.
 *
 * These are Laika *storage objects* rather than documents: they have no
 * published/draft state, they are structured data the page renders, and they
 * live under `content/` so a non-developer can edit them. `objectsLoader` is the
 * loader for that half of the model.
 *
 * Passing `z` makes each loader describe the objects it finds and hand Astro the
 * resulting types, so `entry.data` is typed from the real content rather than
 * being `unknown`. Storage objects have no field list anywhere to derive a
 * schema from — the content is the only description of itself — so the schema
 * stays permissive and these types report rather than constrain.
 *
 * Blog posts are the other half: Laika *documents*, markdown files under
 * `content/posts/` read by `documentsLoader`. Only published documents are
 * loaded, so a draft never reaches the built site. Their frontmatter has a
 * fixed shape, so it gets a real schema rather than an inferred one.
 */
import { documentsLoader, objectsLoader } from '@laikacms/astro/loader';
import { defineCollection, z } from 'astro:content';

const dir = 'content';

export const collections = {
  backends: defineCollection({
    loader: objectsLoader({ dir, defaultExtension: 'yaml', select: { folder: 'backends' }, z }),
  }),
  codeSwap: defineCollection({
    loader: objectsLoader({ dir, defaultExtension: 'yaml', select: { folder: 'code-swap' }, z }),
  }),
  compare: defineCollection({
    loader: objectsLoader({ dir, defaultExtension: 'yaml', select: { folder: 'compare' }, z }),
  }),
  posts: defineCollection({
    loader: documentsLoader({ dir, defaultExtension: 'md', collection: 'posts' }),
    schema: z.object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      author: z.string().default('Laika contributors'),
      tags: z.array(z.string()).default([]),
    }),
  }),
};
