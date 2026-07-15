# Frontend architecture

## Dependency direction

The application is organized so that route code remains thin and domain behavior can evolve without creating another global API or type module.

```text
main -> app -> features -> shared
       app -----------> shared
       shared -> external libraries only
```

`shared` cannot depend on a feature. A feature may use shared HTTP, error, type, utility, and UI modules. Feature pages coordinate route parameters and assemble their own domain components; they do not implement transport or parsing rules. Application layouts and route composition live exclusively under `app`.

## Domain slice

A complete feature slice normally contains:

```text
features/<domain>/
  api/          typed request functions
  components/   domain-specific UI sections
  hooks/        queries, mutations, polling, and orchestration
  lib/          domain-only parsing or packaging utilities, when needed
  pages/        lazy-loaded route coordinators
  queryKeys.ts  one query-key factory
  types.ts      DTO and domain types
```

Not every slice needs every folder. Do not create barrel modules that hide circular dependencies or reintroduce a global API surface.

Cross-directory imports use `@/`; `./` is reserved for files in the same directory. ESLint boundaries enforce `app -> features -> shared` and reject the removed roots `components`, `hooks`, `lib`, `pages`, and `types`.
The `pnpm lint` command also runs `scripts/check-architecture.mjs` to verify the root shape and detect circular TypeScript dependencies.

## Server state

React Query owns server state. A query key must come from its domain factory, for example:

```ts
useQuery({
  queryKey: trainingQueryKeys.job(jobId),
  queryFn: () => getTrainingJob(jobId),
})
```

Mutations invalidate or update keys from the same factory. Local React state is reserved for interaction state such as open dialogs, selected tabs, unsaved editor content, or temporary form values.

The model ID in the current route has priority over local storage. Local storage is only a fallback. When a model-scoped page receives an invalid ID, model selection resolves to the first accessible model without changing backend contracts.

## HTTP and errors

`src/shared/api/client.ts` owns authentication, token refresh, and Axios interceptors. Feature API modules are the only application code that should call that client.

All UI error messages pass through `getApiErrorMessage`. The normalizer handles strings, validation arrays, nested `detail`, and `{ code, detail }` responses so a response object is never rendered as a React child.

## Runtime logs

`src/shared/api/runtimeLogs.ts` normalizes log batches from build, deployment, training, and drift endpoints into `RuntimeLogBatch`. `TerminalViewer` consumes this adapter and accepts callbacks for feature-specific result lookup, keeping shared UI independent from domain APIs.

Runtime output and lifecycle state have different authority:

- Redis-backed logs provide incremental console output.
- The Control Plane database is authoritative for pending/running/completed/failed state.

## Manual upload lifecycle

Manual model upload uses two route coordinators rather than a multi-page wizard:

- `/dashboard/management/model/upload/metadata` saves mutable project metadata, the primary artifact, optional registry attachments, workspace source/data, and requirements.
- `/dashboard/management/model/upload/build-deploy?modelId=<uuid>` snapshots the saved metadata revision into an immutable registry version, builds its image, and streams build/deployment logs through `TerminalViewer`.

The Metadata page validates model name, flavor, and primary artifact before Save or Continue. The artifact format is explicit: raw uploads are limited to the extensions supported by the selected flavor and may use separate label/metrics attachments. A model package upload accepts one `.zip` containing an `MLmodel` file and all package metadata; it does not accept separate artifact attachments. MLflow ZIP is not a separate route.

The Control Plane owns the state transitions. Metadata edits increment a draft revision but do not replace a previous image. The first build of a revision creates registry version `1`; a rebuild of the same revision reuses that version, while a changed revision creates the next version. A ready image may be explicitly saved for later, or deployed immediately. Immediate deployment atomically marks the ready build as saved before creating the deployment.

## Routing and bundles

All route pages use `React.lazy`. The global error boundary prevents a render error from blanking the entire application. Loading fallbacks use shared skeleton/state components.

Monaco is loaded through `LazyCodeEditor`; feature code must not import `@monaco-editor/react` directly. ZIP operations use `fflate`. Keep large editor and packaging code out of the eager application entry chunk.

## Adding a feature

1. Define the domain DTOs and resource IDs.
2. Add feature API functions and query keys.
3. Put orchestration in a feature hook when a page would otherwise contain polling, parsing, or mutation coordination.
4. Build the feature section from shared primitives.
5. Keep the page limited to route input and composition.
6. Add English copy to the domain i18n namespace.
7. Run `pnpm lint` and `pnpm build`, then execute the relevant manual journey.
