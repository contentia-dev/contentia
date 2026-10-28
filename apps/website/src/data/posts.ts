/**
 * Blog posts, newest first.
 *
 * The posts are Contentia documents under `content/posts/` (see content.config.ts).
 * The listing, the post pages and the RSS feed all read them through here, so
 * they agree on the order.
 */
import { type CollectionEntry, getCollection } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export async function getPosts(): Promise<Post[]> {
  return (await getCollection('posts')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function postHref(post: Post): string {
  return `/blog/${post.id}`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

export function formatDate(date: Date): string {
  return DATE_FORMAT.format(date);
}
