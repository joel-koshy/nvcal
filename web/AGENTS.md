# Frontend instructions

## Build target

This package is a Preact + TypeScript SPA intended to be delivered as one inlined HTML response by the Worker. `vite-plugin-singlefile` inlines JavaScript and CSS into `dist/index.html`; compression plugins emit `.br` and `.gz` artifacts, and the visualizer emits `stats.html`.

The compressed-size target is 14.6 KB. It is a hard constraint, but the current build is above it, so always inspect the generated sizes after frontend changes rather than assuming the target passes. Avoid adding dependencies or code-splitting unless the size and single-request architecture are intentionally revisited.

## Source layout

- `src/main.tsx`: DOM entry point and initial-state bootstrap.
- `src/app.tsx`: root layout and application state composition.
- `src/panes/`: `SidebarMonth`, `SidebarCalendars`, `MainWeek`, and `Topbar`.
- `src/components/`: `DialogBox`, `DraftBlock`, `EventBlock`, and `Timeslot`.
- `src/hooks/`: event/calendar data hooks and VIM navigation.
- `src/hooks/vim/VimProvider.tsx`: global pane registry and keyboard routing.
- `src/utils/`: API access and native-JavaScript date calculations.
- `src/types/`: UI-only and API route-map types.
- `src/mock/`: development fallback state.

Use native `Date` APIs for calendar math. Keep shared entities and API contracts in `@nvcal/domain`; frontend imports of domain types should be type-only when runtime code is not needed.

## VIM navigation

Register panes with `usePane()` and focusable elements with `useNavigable()`. Lowercase `h/j/k/l` navigates within the active pane; uppercase `H/J/K/L` follows configured pane neighbors. The pane graph is independent of DOM layout.

`VimDialog` in `src/components/DialogBox.tsx` is an island pane with empty macro-neighbors. Its escape and side-key handling returns focus to the anchor or main pane—the wormhole behavior. Preserve this focus contract when changing dialogs or draft/event interactions.

## Security and rendering

- Never use `dangerouslySetInnerHTML` for user or database content.
- Use normal Preact JSX bindings so text and attributes are escaped contextually.
- Validate any future user-controlled URL before binding it to an `href`; do not permit `javascript:` or other unsafe schemes.
- The Worker injects JSON in an element with `id="initial-state"`; preserve the bootstrap contract used by `main.tsx` and the `NvCalState` type.
- Keep the empty favicon URI in `index.html`: `<link rel="icon" href="data:,">`.

Because the production JavaScript is inline, deployment CSP must allow inline scripts with `script-src 'unsafe-inline'`. Do not add external runtime requests without accounting for the single-request constraint.

## Configuration and commands

The `@` alias currently resolves with `path.resolve(__dirname, './src')` in `vite.config.ts`. Keep documentation aligned with the actual config if this changes.

From the repository root:

```sh
npm run domain:typecheck
npm run web:build
```

From `web/`, `npm run dev` starts Vite and `npm run preview` serves the production artifact. After a production build, inspect `dist/index.html`, `dist/index.html.gz`, `dist/index.html.br`, and `stats.html`.

Terser is currently configured with `drop_console: false` and `drop_debugger: false`; debug logging therefore remains in the bundle unless the build config is deliberately changed.
