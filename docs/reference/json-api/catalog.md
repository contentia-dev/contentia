---
title: Catalog API
aside: false
outline: false
---

<script setup lang="ts">
import { useApiReference } from '../../.vitepress/theme/api-reference';
import { data } from '../examples/code-samples.data';

const OASpec = useApiReference();
</script>

# Catalog API

The Catalog API manages collection settings: the named document and media folders that structure a
store's content. A collection is a `document-collection` or a `media-collection` resource, with its
`key` as the JSON:API `id`. Mount a catalog with
[`buildJsonApi`](../api/contentia/catalog-api/functions/buildJsonApi) from `contentia/catalog-api`.
Like every Contentia API server, it requires an [access policy](./#access-policy).

Every response carries `Cache-Control: no-store`.

<OASpec :spec="data.catalog.spec" :tags="data.catalog.tags" hide-info hide-servers hide-branding />
