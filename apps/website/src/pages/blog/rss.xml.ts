/**
 * The blog's RSS 2.0 feed. Small enough to write by hand, which spares the
 * site an `@astrojs/rss` dependency for one route.
 */
import type { APIRoute } from 'astro';

import { getPosts, postHref } from '../../data/posts';

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async ({ site }) => {
  const posts = await getPosts();
  const base = site ?? new URL('https://laikacms.com');
  const link = (path: string) => new URL(path, base).href;

  const items = posts.map(post =>
    `    <item>
      <title>${escapeXml(post.data.title)}</title>
      <link>${link(postHref(post))}</link>
      <guid isPermaLink="true">${link(postHref(post))}</guid>
      <description>${escapeXml(post.data.description)}</description>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
${post.data.tags.map(tag => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Laika blog</title>
    <link>${link('/blog')}</link>
    <description>Release notes, design decisions and guides for the Laika content API.</description>
    <language>en</language>
    <atom:link href="${link('/blog/rss.xml')}" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
