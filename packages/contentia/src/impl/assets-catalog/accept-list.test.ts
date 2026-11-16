import { describe, expect, it } from 'vitest';

import { isAccepted } from './accept-list.js';

const png = { mimeType: 'image/png', names: ['uploads/photo.png'] };

describe('isAccepted', () => {
  it.each([
    ['an empty list', [], png],
    ['an exact MIME type', ['image/png'], png],
    ['a MIME type in another case', ['IMAGE/PNG'], png],
    ['a MIME type, ignoring parameters', ['text/plain'], { mimeType: 'text/plain; charset=utf-8', names: ['a.txt'] }],
    ['a MIME type wildcard', ['image/*'], png],
    ['the any-type wildcard', ['*/*'], png],
    ['a file extension', ['.png'], png],
    ['a file extension in another case', ['.PNG'], { mimeType: 'image/png', names: ['uploads/PHOTO.Png'] }],
    ['a file extension on any of the names', ['.png'], { mimeType: 'image/png', names: ['blob', 'uploads/a.png'] }],
    ['one entry of several', ['.jpg', 'image/*'], png],
  ])('admits an asset matching %s', (_, accept, asset) => {
    expect(isAccepted(accept, asset)).toBe(true);
  });

  it.each([
    ['another MIME type', ['image/jpeg'], png],
    ['another wildcard', ['video/*'], png],
    ['a wildcard that only shares a prefix', ['image/*'], { mimeType: 'imagery/png', names: ['a.png'] }],
    ['another file extension', ['.jpg'], png],
    ['an extension that is only a suffix of the name', ['.png'], { mimeType: 'image/png', names: ['uploads/xpng'] }],
  ])('turns away an asset matching only %s', (_, accept, asset) => {
    expect(isAccepted(accept, asset)).toBe(false);
  });
});
