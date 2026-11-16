---
title: Assets API
aside: false
outline: false
---

<script setup lang="ts">
import { useApiReference } from '../../.vitepress/theme/api-reference';
import { data } from '../examples/code-samples.data';

const OASpec = useApiReference();
</script>

# Assets API

The Assets API manages binary files (assets) and the folders that group them. Its default base path
is `/api/assets`. Resource routes are mounted under `/resources`; `/capabilities`, `/sync-token`,
`/changes` and `/operations` sit directly on the base path. Mount an assets repository with
[`buildAssetsApi`](../api/contentia/assets/api/functions/buildAssetsApi) from
`contentia/assets/api`. Like every Contentia API server, it requires an
[access policy](./#access-policy).

| JSON:API type         | Description                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `asset`               | A binary file with optional metadata                                                             |
| `folder`              | A logical grouping of assets                                                                     |
| `asset-url`           | Public/private access URLs for an asset (included resource)                                      |
| `asset-variation`     | Derived variations of an asset, e.g. image thumbnails (included resource)                        |
| `assets-capabilities` | What the backend supports (pagination, change signals, filters); returned by `GET /capabilities` |

An asset's URLs and variations are sideloaded with `?include=urls,variations`. Its metadata (MIME
type, size, dimensions) is not an included resource: `?meta=true` inlines it on the asset's
`data.meta` instead.

Keys that contain `/` are percent-encoded in URLs: `images/hero.jpg` becomes `images%2Fhero.jpg`.

`GET /` lists the endpoints and is the one route the access policy doesn't guard.
`GET /openapi.json` and `GET /openapi.yaml` serve the spec the list below is rendered from.

<OASpec :spec="data.assets.spec" :tags="data.assets.tags" hide-info hide-servers hide-branding />
