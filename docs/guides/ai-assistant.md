# AI Assistant

`contentia/server/ai` provides the chat and session endpoints behind an editor's AI assistant. It
authenticates a Bearer token, streams a model response through the Vercel AI SDK, and persists
conversations through consumer-supplied callbacks.

```bash
pnpm add contentia ai @ai-sdk/anthropic
```

`ai` and the `@ai-sdk/*` provider are only needed when you mount these endpoints; swap
`@ai-sdk/anthropic` for whichever provider you use.

## Wiring example

```typescript
import { resolveBearer } from 'contentia/auth';
import { decapAi } from 'contentia/server/ai';
import { anthropic } from 'contentia/server/ai/providers';

const ai = decapAi({
  model: anthropic('claude-sonnet-5-5'),
  basePath: '/api/ai',
  authenticateAccessToken: async token => {
    const ctx = await resolveBearer(token, { verifySessionToken, lookupPatByHash });
    if (!ctx) throw new Error('Unauthorized');
    return { ...ctx.user, scopes: ctx.scopes };
  },
  callbacks: {
    createSession,
    getSession,
    getSessionsByDocument,
    updateSession,
    deleteSession,
  },
});

export default { fetch: ai.fetch.bind(ai) };
```

Re-export `tool`, `jsonSchema`, and the model factories from `contentia/server/ai` rather than
importing `ai` directly — this keeps a single physical `ai` package and ensures branded tool/schema
types match.

## Endpoints

All paths are relative to `basePath` (default `/api/ai`). Every endpoint except `/health` requires
`Authorization: Bearer <token>` and the `requiredScope`.

| Method   | Path            | Purpose                                                       |
| -------- | --------------- | ------------------------------------------------------------- |
| `GET`    | `/health`       | Liveness probe; no auth                                       |
| `POST`   | `/chat`         | Streams a response; body `{ messages, sessionId?, document }` |
| `GET`    | `/sessions`     | Sessions for `?documentSlug=`, scoped to the caller           |
| `GET`    | `/sessions/:id` | One session with its full message history                     |
| `DELETE` | `/sessions/:id` | Deletes a session the caller owns                             |

`POST /chat` replies with the AI SDK's UI message stream and an `X-Session-Id` header.

## `DecapAiConfig` options

| Option                    | Type                                                                                       | Required | Default            | Description                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------ | -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`                   | `LanguageModel`                                                                            | ✓        | —                  | Vercel AI SDK model (e.g. `anthropic('claude-sonnet-5-5')`)                                                                                                                                                                                                                           |
| `authenticateAccessToken` | `(token) => User`                                                                          | ✓        | —                  | Validate a Bearer token; return `{ ...ctx.user, scopes: ctx.scopes }` from [`resolveBearer`](../reference/api/contentia/auth/functions/resolveBearer)                                                                                                                                 |
| `callbacks`               | [`AiSessionCallbacks`](../reference/api/contentia/server/ai/interfaces/AiSessionCallbacks) | ✓        | —                  | Session persistence; see below                                                                                                                                                                                                                                                        |
| `basePath`                | `string`                                                                                   |          | `'/api/ai'`        | URL prefix for all endpoints                                                                                                                                                                                                                                                          |
| `requiredScope`           | [`Scope`](../reference/api/contentia/auth/type-aliases/Scope)                              |          | `'content:write'`  | Scope checked against `user.scopes`; users with no scopes (legacy full-admin sessions) are always allowed                                                                                                                                                                             |
| `systemPrompt`            | `string`                                                                                   |          | English CMS prompt | **Replaces** the default system prompt entirely; the default [`getDocumentData`](../reference/api/contentia/server/ai/tools/variables/getDocumentData)/[`updateDocument`](../reference/api/contentia/server/ai/tools/variables/updateDocument) guidance is discarded when this is set |
| `tools`                   | `ToolSet`                                                                                  |          | —                  | Additional server-side tools (with `execute`); see client-side tools note below                                                                                                                                                                                                       |
| `maxOutputTokens`         | `number`                                                                                   |          | `4096`             | Maximum tokens in the model response                                                                                                                                                                                                                                                  |
| `temperature`             | `number`                                                                                   |          | `0.7`              | Sampling temperature                                                                                                                                                                                                                                                                  |
| `logger`                  | `{ error(...): void }`                                                                     |          | —                  | Receives internal errors                                                                                                                                                                                                                                                              |
| `messages`                | [`Translation`](../reference/api/contentia/server/ai/i18n/en/type-aliases/Translation)     |          | English            | Localized error responses and system prompt                                                                                                                                                                                                                                           |

## `AiSessionCallbacks` interface

Consumer-supplied callbacks that persist conversations to your storage (KV, D1, Postgres, etc.).

```typescript
interface AiSessionCallbacks {
  createSession(session: AiSession): Promise<void>;
  getSession(sessionId: string): Promise<AiSession | null>;
  getSessionsByDocument(documentSlug: string, userId: string): Promise<AiSession[]>;
  updateSession(
    sessionId: string,
    updates: Partial<Pick<AiSession, 'messages' | 'title' | 'updatedAt'>>,
  ): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
}
```

## The client

These endpoints are the server half. The other half is a chat transport in your admin that calls
them: it sends `{ messages, sessionId?, document }` to `POST /chat` with the user's Bearer token,
reads the AI SDK's UI message stream back, keeps `X-Session-Id` to continue the conversation, and
runs the client-side tools below against the open entry. Contentia does not ship that transport.

## Client-side tools

`getDocumentData` and `updateDocument` are declared with **no `execute`**, so the SDK ships them to
the browser, where the admin's transport runs them against the open editor draft. Add your own
server-side tools through `config.tools` — those should have an `execute`.

## Authorization

`requiredScope` defaults to `content:write` because the assistant can edit entries. A
[`User`](../reference/api/contentia/server/ai/interfaces/User) with no `scopes` is treated as full
access, matching `resolveBearer`'s convention for legacy sessions; populate `scopes` to gate AI
access separately from content access.
