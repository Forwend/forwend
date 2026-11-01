# Web file and folder structure

These are Forwend's placement and naming rules for new code and explicitly scoped refactors (D-11).
Do not move unrelated code while delivering a feature.
Redux Toolkit with RTK Query is the request cache (D-47); this document does not authorize other state tools,
adding services, or creating empty folders.
Create only the parts a task needs. Behavior and design rules remain in [rules.md](rules.md).

## App ownership

```text
apps/web/src/
  app/                         Next.js routes, layouts, metadata, loading and error boundaries (framework files)
  screens/                     full screens that assemble features; one folder per screen
  features/                    product behavior, one folder per domain, every one laid out the same way
  shared/                      code with a concrete purpose and unrelated consumers, laid out like a feature
  store/                       Redux store assembly and typed hooks
  providers/                   application provider composition
```

## One layout everywhere

A folder holds one kind of code, so where a thing lives follows from what it is (F169). A feature, `shared/` and a
screen with supporting code use the same kind folders, created only when the first file of that kind exists:

```text
features/invoices/
  api/          invoices-api.ts         RTK Query endpoints (injectEndpoints) and their generated hooks
  schemas/      invoices.ts             Zod schemas for requests and responses (F170); types are inferred from them
  types/        invoices.ts             interfaces and type aliases; unions derived from constants/ with `typeof`
  constants/    invoices.ts             finite values and limits (`as const`); invoices-copy.ts: the feature's text
  lib/          invoices.ts             pure functions: no React, no requests
  hooks/        (balances: use-chart.ts) one hook per file, named after it; a React context lives with its hook
  components/   invoice-detail.tsx      React components, and nothing else is .tsx
  tests/        invoices.test.ts        unit tests of this owner
```

- No `.ts` and `.tsx` side by side, and no files at a feature root: only the kind folders. Next.js `app/` keeps the
  framework's file names (`page.tsx`, `robots.ts`).
- A file in `types/`, `constants/` or `lib/` is named after its owner or topic (`invoices.ts`, `receive-address.ts`);
  the folder says the kind. A private helper stays in the file of the only code that uses it.
- `shared/` uses the same folders at its top: `shared/components/chains/token-mark.tsx`, `shared/lib/chains.ts`,
  `shared/constants/chains.ts`, plus `api/` (the RTK Query base), `config/`, `assets/`, `examples/` and `hooks/`.
- A screen folder holds its `.tsx` screen and section components; supporting code goes in the same kind folders
  beside them (`screens/app-shell/lib/app-nav.ts`, `screens/landing/sections/hero/constants/hero-content.ts`).
- A feature owns its components, requests, hooks, state, constants and types. Do not use `shared/` for code whose
  owner is unclear: identify the feature first.
- Put component-only props beside the component, domain types in the feature's `types/`, and shared types in
  `shared/types/`. Define each domain concept once; derive related types from the owner (`Pick`, `extends`, an indexed
  type) instead of copying fields. Keep HTTP request and response shapes apart from internal types when they differ.
- Keep finite domain values in `constants/` and derive unions from them. Use type-only imports.

## TypeScript and React conventions

- A component is a function declaration with its props typed on the parameter: `export function TokenMark({ chainId }:
  TokenMarkProps)`. No `React.FC`: it adds nothing on a declaration and hides generics.
- Props of an exported component are an `interface <Component>Props` beside it; a private component may type its
  props inline. No `I` prefix (`Props`, not `IProps`): TypeScript's own style names interfaces by what they describe.
- Let TypeScript infer a component's return type; annotate the return type of exported non-component functions.
- Prefer `interface` for object shapes and `type` for unions, mapped types and aliases.
- Use the shared kit (`@forwend/ui-web`) for every control: `Button` (variants primary, secondary, ghost, link and
  soon), `IconButton` (icon-only, with a required label), `RowButton` (a full-width choice or menu trigger), `Form`,
  `ChoiceCard`, the fields, `TruncatedAddress` and the rest. A link that looks like a button uses `buttonClasses`.
  Raw controls remain only where the kit has no such control and the element is used once:
  - `screens/app-shell/command-menu.tsx`: the search box is an ARIA combobox inside its own dialog.
  - `screens/app-shell/app-header.tsx`: the two search triggers that look like a field and open the command menu.
  - `screens/app-shell/phone-tab-bar.tsx`: the More tab is a button styled exactly like its sibling tab links.
  - `features/stores/components/store-form.tsx`: the browser's color picker, as the Accent color field's action.
  - `features/stores/components/store-logo.tsx`: a hidden file input that the Upload logo button opens.
  Add a kit component instead the second time any of these is needed.

## Landing sections

```text
screens/landing/
  landing-screen.tsx
  landing.module.css                 page layout and section styles
  layout/                            editorial-nav.tsx, garden-footer.tsx and their CSS modules
  sections/
    hero/                            open-path-hero.tsx
      constants/                     hero-content.ts, also used by the share image
    payment-workspace.tsx            payment previews and the three-step journey
    next-chapter.tsx                 roadmap and questions
    next-chapter.module.css
```

Group the hero's rendering and supporting copy together. Keep section-only styles beside their component.
A folder is useful when a section has supporting files, not merely because it appears on the page.
The landing uses sign-in links instead of a waitlist form.
An image also used by sign-in is shared branding, not landing-only data.

## Requests, services and hooks

| Kind | Job | Example |
|---|---|---|
| API file | Request definitions, response mapping and request-cache rules | `features/profiles/api/profiles-api.ts` |
| Logic | A meaningful operation independent of React | `features/invoices/lib/invoices.ts` |
| Hook | React state, lifecycle or interaction coordination | `features/profiles/hooks/use-app-session.ts` |
| Component | Rendering and simple event handling | `features/profiles/components/new-profile-form.tsx` |

Logic is plain functions in `lib/`. Do not add a service that only forwards a request, or wrap a generated query
hook without additional behavior. Backend services remain responsible for authorization, transactions and
money rules. Frontend validation does not replace backend validation.

## Redux and request caching

The store holds only the RTK Query request cache. What exists:

- `store/store.ts`: `makeStore`, `AppStore`, `RootState` and `AppDispatch`; one store per tab, never a server-wide
  singleton.
- `providers/store-provider.tsx` (signed-in app, inside Privy) and `providers/public-store-provider.tsx` (`/pay`,
  `/reminders/<token>`, `/w/<token>` and `/l/<slug>`, no token).
- `shared/api/api-slice.ts`: the one `apiSlice` with the common request setup. Each feature injects its endpoints in
  `features/<feature>/api/<feature>-api.ts` with `injectEndpoints`; no endpoints in the shared file and no second
  `createApi`.

No slices, typed store hooks or plain fetch client exist. Add `store/hooks.ts` and
`features/<feature>/store/<feature>-slice.ts` only with the first client state shared across screens, and never fetch
an endpoint outside RTK Query.

Keep menu state, forms and animations local. Put shareable filters in the URL. Use a request cache for server
data; do not also copy the same responses into ordinary slices. Redux is for client state shared across screens.
Profile-specific queries include the profile identity in their cache arguments, and sign-out clears private
cached data. Preserve the project's exact money representation; do not convert amounts to floating point to
fit a store.

Server Components do not read or write Redux. Fetch server-rendered data on the server; use RTK Query for client
requests. Follow [Redux with Next.js](https://redux.js.org/usage/nextjs) and [endpoint splitting](https://redux.js.org/toolkit/rtk-query/usage/code-splitting).

## Shared UI package

Group by the purpose of the component. The groups below place the current component families; add another only
for a distinct family of real components. Avoid one flat folder for every component in the package.

```text
packages/ui-web/src/
  components/
    buttons/                   button, action-button, icon-button, row-button
    forms/                     text-field, text-area-field, amount-field, select-field, combobox-field, search-field,
                               checkbox, switch, switch-card, choice-card, code-input, email-capture, form,
                               field-classes, date-picker/ (calendar, date-picker, iso-date)
    navigation/                tabs, nav-pill, theme-switch, segmented-control, select-menu
    overlays/                  dialog, sheet, menu, tooltip
    feedback/                  toast, empty-state, spinner, skeleton, shimmer, dot-loader, success-check
    display/                   panel, badge, stat-tile, accordion, progress-bar, code-block
    payments/                  money, address, activity-row, status-pill, token-chip, payment-timeline,
                               receive-address, network-warning, qr-code
  hooks/                       hooks shared by multiple component families
  lib/                         small named capabilities shared by component families
  types/                       types shared by component families, grouped by domain
  icons/
  index.ts                     stable public package exports
```

- Start with `components/buttons/button.tsx`. When a component gains supporting files, give it a folder and name
  each file after its topic, as `payments/money/` holds `money.tsx` and `token-amount.ts`. Keep simple props in the component file. Do not create a folder just to hold a single
  file.
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
- API definitions must not import the store instance. Type-only references do not create runtime dependencies.
- Use direct imports inside an owner. Do not add an `index.ts` in every directory. Keep a deliberate public entry
  point where there is a real package boundary. Keep server-only modules out of client import paths and preserve
  small client boundaries; see [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
- Put unit tests in a `tests/` folder inside their owner: the feature (`features/balances/tests/`), the shared
  capability (`shared/api/tests/`), the screen, or the UI component family (`components/payments/tests/`,
  `hooks/tests/`). No repository-wide folder for application tests. `packages/design-tokens` and `packages/node` keep
  their `test/` folders. Flow and browser tests stay in `apps/web/e2e/`; the live Privy tests share their sign-in setup in
  `e2e/privy/`. Go tests follow [backend rules](../backend/rules.md#layout).
- When moving existing tests, update Vitest discovery and prove the same tests still run. Update aliases, package
  exports, fixtures and docs with a move.
- A structure refactor preserves routes, rendered behavior, API contracts and package exports. Run the existing
  relevant unit, type, build and browser checks through the harness. Do not install new state tools as part of a move.
