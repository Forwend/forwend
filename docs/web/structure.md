# Web file and folder structure

These are Forwend's placement and naming rules for new code and explicitly scoped refactors (D-11).
Existing files may still use the old layout. Do not move unrelated code while delivering a feature.
This document does not authorize installing Redux, adding services, or creating empty folders.
Create only the parts a task needs. Behavior and design rules remain in [rules.md](rules.md).

## App ownership

```text
apps/web/src/
  app/                         Next.js routes, layouts, metadata, loading and error boundaries
  screens/                     full screens that assemble features
    landing/
    app-shell/                 signed-in frame: sidebar, phone header and tab bar
    dashboard/
    balances/
    activity/
    new-profile/
    sign-in/
    kit/                       /kit
    kit-directions/            /kit/directions
  features/                    product behavior, grouped by domain
    auth/
    profiles/
    balances/
    receive/
    activity/
    waitlist/
  shared/                      code used by unrelated screens or features
    api/                       request client, API errors, optional RTK Query setup
    hooks/                     domain-independent React hooks
    config/                    shared application configuration
    assets/                    shared image references; actual images stay in public/
    chains/                    supported networks, their names and token marks
    art/                       code-drawn illustrations used by landing and kit
    examples/                  sample data shown on more than one screen
    formatting/                shared formatting functions
    components/                app-wide composition that does not belong in ui-web
  store/                       optional Redux store assembly and typed hooks
  providers/                   application provider composition
```

- A route selects and configures a screen; a screen arranges feature components. Keep substantial feature logic
  out of `page.tsx` and `layout.tsx`. Use `screens/`, not a second Next.js `pages/` routing directory.
- A feature owns its components, API requests, hooks, services, state, constants and types. Small features can
  keep descriptive files directly in their folder. Add `components/`, `api/`, `hooks/`, `services/`, `store/`,
  `types/` or `constants/` only when a real group of files needs it.
- Put component-only props beside the component, domain types beside their feature, and shared types beside
  the shared capability that owns them. Do not recreate global `types/app/` or mixed `types/ui/display.ts` files.
- Keep section copy and demo data with their screen or section. Data genuinely used across screens, such as
  sample invoices on landing and kit, belongs in a named shared group such as `shared/examples/`.
- Keep finite domain values in one owner-local constants file and derive unions from them. Use type-only imports.
- Do not use `shared/`, `lib/`, `utils/` or `services/` as a destination for code whose owner is unclear. Identify
  the feature first. Shared code needs a concrete purpose and actual unrelated consumers.

## Landing sections

```text
screens/landing/
  landing-screen.tsx
  layout/
    site-nav.tsx
    site-footer.tsx
    section.tsx
  sections/
    hero/
      hero.tsx
      hero-journey.tsx
      hero-payment.tsx
      use-hero-journey.ts
      hero-content.ts
      hero-motion.ts
      river.ts
    profile-preview/
      profile-preview.tsx
      panel-layout.tsx
      personal-panel.tsx
      freelancer-panel.tsx
      merchant-panel.tsx
      developers-panel.tsx
      profile-preview-content.ts
      profile-preview-samples.ts
    checkout-preview/
      checkout-preview.tsx
      checkout-preview-content.ts
    faq.tsx
    fees.tsx
    networks.tsx
    ...                        other simple sections can remain single files
  landing-content.ts           remaining page-level copy
```

Group the hero's rendering, animation and supporting data together. Keep independent profile demos in named
files; a tiny private rendering helper may stay with its component. A folder is useful when a section has
supporting files, not merely because it appears on the page. Waitlist behavior belongs in `features/waitlist/`;
the landing screen uses it in the hero and closing section. The current mock needs no request service.
An image also used by sign-in is shared branding, not landing-only data.

## Requests, services and hooks

| Kind | Job | Example |
|---|---|---|
| API file | Request definitions, response mapping and request-cache rules | `features/profiles/api/profiles-api.ts` |
| Service | A meaningful operation independent of React | `features/invoices/services/prepare-invoice-draft.ts` when that behavior exists |
| Hook | React state, lifecycle or interaction coordination | `features/profiles/hooks/use-create-profile.ts` |
| Component | Rendering and simple event handling | `features/profiles/components/new-profile-form.tsx` |
| Slice | A feature's shared client state and updates | `features/profiles/store/profiles-slice.ts` if Redux is adopted |

Services can be plain functions. Do not add a service that only forwards a request, or wrap a generated query
hook without additional behavior. Backend services remain responsible for authorization, transactions and
money rules. Frontend validation does not replace backend validation.

## Redux and request caching, when adopted

Use established Redux terms: store, slice, reducer, selector, query and mutation. Use these filenames consistently:

- `store/store.ts`: exports `makeStore`, `AppStore`, `RootState` and `AppDispatch`; the filename describes the
  module, while `makeStore` names the function. Do not create a server-wide singleton store.
- `store/hooks.ts`: typed `useAppDispatch`, `useAppSelector` and `useAppStore` hooks as needed. Imports of store
  types are type-only; this module must not import the running store.
- `providers/store-provider.tsx`: the client provider; mount it around the app routes that need Redux.
- `features/<feature>/store/<feature>-slice.ts`: feature state and reducers. Keep selectors beside the slice;
  extract `<feature>-selectors.ts` only when their logic warrants a separate file.
- `shared/api/api-slice.ts`: if using RTK Query, the shared `apiSlice` for our backend, with common request setup.
  Define endpoints in `features/<feature>/api/<feature>-api.ts` using `injectEndpoints`. Do not collect all
  feature endpoints in the shared file or create a separate `createApi` instance for every feature.
- `shared/api/client.ts`: the plain request client if needed. Do not maintain duplicate fetch and RTK Query
  implementations for the same endpoint.

These names adapt Redux's `store.ts`, `hooks.ts` and `apiSlice.ts` examples to this repo's kebab-case filenames;
they are our convention, not framework-required paths. See the official [store example](https://redux.js.org/tutorials/essentials/part-2-app-structure)
and [API slice example](https://redux.js.org/tutorials/essentials/part-7-rtk-query-basics).

Keep menu state, forms and animations local. Put shareable filters in the URL. Use a request cache for server
data; do not also copy the same responses into ordinary slices. Redux is for client state shared across screens.
Profile-specific queries include the profile identity in their cache arguments, and sign-out clears private
cached data. Preserve the project's exact money representation; do not convert amounts to floating point to
fit a store. State serialization must be addressed explicitly when introducing Redux.

Server Components do not read or write Redux. Fetch server-rendered data on the server; use RTK Query for client
requests. Follow [Redux with Next.js](https://redux.js.org/usage/nextjs) and [endpoint splitting](https://redux.js.org/toolkit/rtk-query/usage/code-splitting).

## Shared UI package

Group by the purpose of the component. The groups below place the current component families; add another only
for a distinct family of real components. Avoid one flat folder for every component in the package.

```text
packages/ui-web/src/
  components/
    buttons/                   button, action-button
    forms/                     text-field, select-field, checkbox, switch, code-input, email-capture
    navigation/                tabs, nav-pill, theme-switch
    overlays/                  dialog, sheet, menu, tooltip
    feedback/                  toast, empty-state, spinner, skeleton, shimmer, dot-loader, success-check
    display/                   panel, badge, stat-tile, accordion, progress-bar, code-block
    payments/                  money, address, activity-row, status-pill, token-chip, payment-timeline,
                               receive-address, network-warning, qr-code
  hooks/                       hooks shared by multiple component families
  lib/                         small named capabilities shared by component families
  constants/                   values shared by component families
  types/                       types shared by component families, grouped by domain
  icons/
  index.ts                     stable public package exports
```

- Start with `components/buttons/button.tsx`. When a component gains supporting files, use
  `components/buttons/button/button.tsx`, `button.types.ts` and `button.test.tsx` as needed. Keep simple props
  in the component file. Do not create a folder just to hold a single file.
- Keep related compound parts together: `Menu`, `MenuItem` and `MenuTrigger` can share `overlays/menu.tsx`.
  Independently maintained components deserve separate files. Split by responsibility, not an arbitrary line limit.
- Put family-only hooks, styles, types and constants in that family; promote them to package-wide folders only
  for real reuse. Avoid a mixed file containing props for unrelated components.
- App features import public `@forwend/ui-web` exports. Package internals use direct local imports, not their own
  root index. Moving files must preserve public names and the kit examples.

## Names, imports and checks

- Use kebab-case for TS/TSX filenames, PascalCase for components/types, `useX` for hooks and verbs for operations.
  Preserve framework filenames such as `page.tsx` and `layout.tsx`. Avoid `manager`, `helpers`, `common`, `misc`,
  numbered files and repeated `global` prefixes that do not explain the responsibility.
- Routes and providers compose the app. Screens import features and shared code. Features import shared code
  and UI packages; shared code and UI packages never import screens or features. A feature does not import
  another feature's private files. Compose independent features in a screen; any necessary public dependency
  between features must be named in the architecture and remain acyclic.
- Store assembly may import feature reducers. Feature components may use typed store hooks; slices and API
  definitions must not import the store instance. Type-only references do not create runtime dependencies.
- Use direct imports inside an owner. Do not add an `index.ts` in every directory. Keep a deliberate public entry
  point where there is a real package boundary. Keep server-only modules out of client import paths and preserve
  small client boundaries; see [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- Put unit tests beside their source and flow tests in `e2e/`. When moving existing tests, update Vitest discovery
  and prove the same tests still run. Update aliases, package exports, fixtures and docs with a move.
- A structure refactor preserves routes, rendered behavior, API contracts and package exports. Run the existing
  relevant unit, type, build and browser checks through the harness. Do not install new state tools as part of a move.

The feature grouping is informed by [Bulletproof React](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)
and [Feature-Sliced Design](https://fsd.how/docs/reference/slices-segments/). We use the simpler names above rather
than adopting every layer of either template. Next.js permits [multiple organization approaches](https://nextjs.org/docs/app/getting-started/project-structure);
the concrete paths and UI categories in this document are Forwend's choices.
