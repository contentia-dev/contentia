---
"contentia": patch
---

`CatalogAssetsRepository` now matches a media collection's `accept` list the way its schema
describes it, as the HTML `accept` attribute does: MIME types (`image/png`), wildcards (`image/*`),
and file extensions (`.png`, matched against the asset's filename and key), ignoring case and MIME
type parameters. Before, only an exact MIME type matched, so a collection that accepted `image/*` or
`.png` turned away every upload.

`updateAsset` now also checks a changed `mimeType` against the list, so a PATCH can no longer give
an asset a type its collection doesn't accept.
