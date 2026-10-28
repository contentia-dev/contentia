# AI Agents Guide

Contentia is a **modular, runtime-agnostic content API**. One API over any storage backend, works
with any JavaScript runtime.

## Principles

1. **Modularity** - Each package has a single responsibility
2. **Runtime Agnostic** - Avoid Node.js-specific APIs in core packages
3. **Minimal Dependencies** - Keep bundle sizes small and reduce the likelihood of rogue packages

## Documentation

Docs are in `docs/` and are the whole contentia.dev site (the docs index is the homepage; no
separate marketing site). Use relative links:

- To other docs: `[Architecture](./concepts/architecture.md)`
- To packages: `[storage](./packages/domain/storage)`

## Code Style

- Files: `kebab-case.ts`
- Classes: `PascalCase`
- Functions: `camelCase`
- Use `workspace:*` for internal dependencies
- Use `catalog:` for shared dependencies

## Do NOT

- Add Node.js-specific APIs to domain packages
- Avoid exposing Effect types in public APIs
- Add heavy dependencies without discussion
- **Create `.github/workflows/*.yml` files.** GitHub Actions billing is frozen fleet-wide
  (2026-06-17). New checks belong in husky hooks / `package.json` scripts. Existing workflows are
  grandfathered — do not delete them. The only override is a commit message containing
  `[owner-approved-workflow]`.

## Recoverable warnings & delegation: `runValueForwarding`

`ContentiaTask` and `ContentiaStream` both carry recoverable warnings (and progress events) as
first-class metadata alongside the resolved value or stream data. Backends emit warnings via
`emit.recoverableError(err)` when something partially failed but the operation still produced a
usable result (e.g. an R2 readback fell back to a synthesised resource, a corrupt row was skipped,
an unreadable subfolder was passed over).

When you write a higher-level repository that delegates to a lower-level one (e.g. a
`documents-catalog` method calling `this.storageRepository.createObject(...)`), use the
**forwarding** drainers — not the discarding ones:

```ts
// ✅ Forward inner warnings into the outer task's emit
return ContentiaTask.make<Document>(emit =>
  Effect.gen({ self: this }, function*() {
    const obj = yield* ContentiaTask.runValueForwarding(
      this.storageRepository.createObject({ ... }),
      emit,
    );
    return this.toDocument(create.key, obj);
  })
);

// ❌ Drops inner warnings — they die at the delegation boundary
const obj = yield* ContentiaTask.runValue(this.storageRepository.createObject({ ... }));
```

Same rule for streams: `ContentiaStream.runCollectForwarding(stream, emit)` instead of
`ContentiaStream.runCollect(stream)`.

`runValue` / `runCollect` are still correct for top-level boundary code (an API server draining a
task into a Promise, test setup, etc.) — they're only a footgun inside a `make` body that's part of
a delegation chain.

### Routing warnings into observability

The Decap backend's `onWarning` hook is the recommended attach point for routing recoverable
warnings into a host app's observability stack. The callback receives the typed `ContentiaError`
directly, so its `.code` / `.message` / `.cause` / `.translation` fields are all available for
tagging.

When tagging warnings into Sentry / OpenTelemetry / Datadog / etc., prefer the following conventions
so distributed traces stay correlatable across the pipeline:

| Tag / attribute           | Source                          | Notes                                                  |
| ------------------------- | ------------------------------- | ------------------------------------------------------ |
| `contentia.warning.code`  | `error.code` (e.g. `not_found`) | The typed ContentiaError code; stable across releases. |
| `contentia.warning.title` | `error.title`                   | Human-readable group label.                            |
| `contentia.warning.repo`  | host-supplied                   | Which repository surfaced it (e.g. `storage-r2`).      |
| `contentia.warning.op`    | host-supplied                   | The operation in progress (e.g. `createObject`).       |

Treat warnings as **breadcrumbs**, not exceptions — they describe partial-success states, so
recording them at `level: 'warning'` (Sentry) / severity `WARN` (OTel) keeps alerting on real
failures, not user-visible partial successes. Example:

```ts
const LaikaBackend = createLaikaBackend({
  onWarning: e => {
    Sentry.addBreadcrumb({
      category: 'contentia.warning',
      level: 'warning',
      message: e.message,
      data: { 'contentia.warning.code': e.code, 'contentia.warning.title': e.title },
    });
  },
});
```

If you also send a metric counter, use a `contentia_warning_total` counter labelled by `code` — not
by `message`, since messages carry per-call detail strings that would explode cardinality.
