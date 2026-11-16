---
title: Documents API
aside: false
outline: false
---

<script setup lang="ts">
import { useApiReference } from '../../.vitepress/theme/api-reference';
import { data } from '../examples/code-samples.data';

const OASpec = useApiReference();
</script>

# Documents API

The Documents API serves versioned content with a publish/unpublish lifecycle. A document is in one
of two states:

- **Published** (`type: "published"`): live, public content.
- **Unpublished** (`type: "unpublished"`): drafts, pending-review, archived, or trashed content,
  told apart by a `status` string.

A **revision** is an immutable snapshot of a document, created with `POST /revisions`. Its `id` is
the document key and the revision identifier joined by `/` (`posts/hello/v1`). Mount a documents
repository with [`buildJsonApi`](../api/contentia/documents/api/functions/buildJsonApi) from
`contentia/documents/api`. Like every Contentia API server, it requires an
[access policy](./#access-policy).

| JSON:API type            | Domain entity                                                                            | Description                                              |
| ------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `published`              | [`Document`](../api/contentia/documents/type-aliases/Document)                           | Live published document                                  |
| `published-summary`      | [`DocumentSummary`](../api/contentia/documents/type-aliases/DocumentSummary)             | Published document without content                       |
| `unpublished`            | [`Unpublished`](../api/contentia/documents/type-aliases/Unpublished)                     | Draft or otherwise unpublished document                  |
| `unpublished-summary`    | [`UnpublishedSummary`](../api/contentia/documents/type-aliases/UnpublishedSummary)       | Unpublished document without content                     |
| `revision`               | [`Revision`](../api/contentia/documents/type-aliases/Revision)                           | Immutable historical snapshot                            |
| `revision-summary`       | [`RevisionSummary`](../api/contentia/documents/type-aliases/RevisionSummary)             | Revision without content                                 |
| `folder`                 | [`Folder`](../api/contentia/storage/type-aliases/Folder)                                 | Folder entry in a records listing                        |
| `folder-summary`         | [`FolderSummary`](../api/contentia/storage/type-aliases/FolderSummary)                   | Folder entry in a record summaries listing               |
| `documents-capabilities` | [`DocumentsCapabilities`](../api/contentia/documents/type-aliases/DocumentsCapabilities) | Repository capabilities; returned by `GET /capabilities` |

Keys and revision identifiers that contain `/` are percent-encoded in URLs: `posts/hello-world`
becomes `posts%2Fhello-world`. A document created without a `language` gets `und` (undetermined).
The API also describes itself at `GET /`.

<OASpec :spec="data.documents.spec" :tags="data.documents.tags" hide-info hide-servers hide-branding />
