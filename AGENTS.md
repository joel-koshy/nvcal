# NVCAL Architecture & Context Document

## 1. System Objective
NVCAL is a brutalist, hyper-optimized, VIM-navigable calendar web application. The absolute primary constraint is that the **entire application (HTML + CSS + Interactive JavaScript) must be delivered in a single HTTP request under 14.6 KB** (fitting perfectly within a single TCP slow-start packet window). 

## 2. Tech Stack & Build Tools
* **Framework:** Preact + TypeScript. Chosen because it provides a modern Virtual DOM and component architecture but features a microscopic ~3 KB baseline runtime.
* **Bundler:** Vite.
* **Minification:** Terser (configured to aggressively drop console logs and debuggers).
* **Vite Plugins:**
    * `vite-plugin-singlefile`: Forces Rollup to inline all JS and CSS directly into the `index.html` file, preventing subsequent network round-trips.
    * `vite-plugin-compression2`: Generates Brotli (`.br`) and Gzip (`.gz`) artifacts to precisely measure the byte budget.
    * `rollup-plugin-visualizer`: Generates a `stats.html` treemap to audit bundle sizes.
* **Monorepo (npm workspaces):** a single root workspace with three packages — `web/` (Preact SPA), `backend/` (Cloudflare Worker), and `packages/domain/` (`@nvcal/domain`). Zod schemas live once in `@nvcal/domain` and are the single source of truth shared by both frontend and backend.
* **Backend stack:** Hono + Cloudflare D1 (SQLite) + Queues, with `@hono/zod-validator`. Incoming bodies are validated against `@nvcal/domain` request schemas; outgoing responses are validated against `@nvcal/domain` response schemas.
* **Unified type layer:** entities (`Event`, `Calendar`, `Task`), request bodies, and response shapes are defined once in `@nvcal/domain`. The backend uses them for runtime validation; the SPA imports them as type-only references, so they contribute **zero bytes** to the single-file bundle.

## 3. Strict Constraints & Trade-offs
* **Zero Dependency Policy:** Heavy date math libraries and headless UI wrappers are banned. Calendar grids must be generated using native JavaScript `Date` APIs.
* **Single-File Drawbacks:** Inlining the app into `index.html` breaks browser file caching and prohibits code-splitting (no dynamic `import()`). Given the <10KB total size, network handshakes take longer than the download, making these trade-offs highly acceptable.
* **The Favicon Void:** To prevent Vite's SPA fallback from serving the entire application a second time when the browser requests a favicon, the HTML must include a 31-byte empty data URI: `<link rel="icon" href="data:,">`.

## 4. Security Architecture & XSS Nuances
Because `vite-plugin-singlefile` places all JavaScript directly inside the HTML, standard strict Content Security Policies (CSP) will block the app from running.
* **CSP Requirement:** The hosting server must output a CSP containing `script-src 'unsafe-inline'`.
* **XSS Mitigation:** By allowing inline scripts, the app relies entirely on Preact's context-aware auto-escaping. Preact uses `textContent` (not `innerHTML`) to bind data, neutralizing 99% of injected `<script>` tags by rendering them as literal text.
* **The Dangerous 1% (Strict Rules):**
    1.  **Never** use `dangerouslySetInnerHTML`. If rich text from a database is required, it must be passed through a strict DOM sanitizer first.
    2.  **Never** bind user data to a generic `href` without validating that it begins with `https://`. This prevents `javascript:alert(1)` URI execution attacks.
    3.  **Always** use Preact's standard JSX prop bindings to prevent unquoted attribute injection.

## 5. Repository Structure
```text
nvcal/
├── packages/domain/      # @nvcal/domain — single source of truth (zod schemas)
│   └── src/
│       ├── entities/     # Event, Calendar, Task schemas (output/input)
│       ├── api/          # Request schemas: Create/Update/TimeWindow, Credentials
│       └── api/responses/ # Response contracts enforced by backend routes
├── backend/              # Cloudflare Worker (Hono + D1 + Queues + zod)
│   └── src/
│       ├── routes/       # api/events, api/sync, auth, page, webhooks
│       ├── queue/        # export / import / webhook processors
│       └── util/         # crypto, oauth, typed response helper
└── web/                  # Preact single-file SPA (<14 KB gzip)
    └── src/
        ├── panes/       # MainWeek, SidebarMonth, SidebarCalendars, Topbar
        ├── hooks/       # useEvents, useCalendars, vim/ engine (VimProvider, usePane, useNavigable)
        ├── components/  # DialogBox, DraftBlock, EventBlock, Timeslot
        ├── types/       # UI-only shapes + API route maps (type-only, 0 bytes)
        ├── mock/        # MOCK_EVENTS / calendar colors (dev fallback)
        └── utils/       # api fetch wrapper, native-JS date math
```

## 6. Key Implementation Details
* **VIM Navigation Engine:** Navigation is entirely decoupled from the DOM structure using a global Context provider. Using usePane(), components define localized cols, flow, and neighbors. The engine dynamically calculates a mathematical (X, Y) coordinate map for the UI.
    Micro-Navigation (h,j,k,l): Moves the cursor sequentially through the 2D coordinate map, featuring row-wrapping logic. 
    Macro-Navigation (Shift + H,J,K,L): Jumps between adjacent layout panes using the defined neighbors graph.
* The "Wormhole" and "Island Pane" Patterns: The EventDialog is registered as a functioning pane (so j/k works on the inputs) but defines an empty neighbor map (neighbors: {}), making it an "Island." It cannot be reached by macro-navigation. Instead, components use the "Wormhole Pattern," utilizing
* **Bulletproof Path Aliasing:** In `vite.config.ts`, the `@` alias is defined using `fileURLToPath(new URL('./src', import.meta.url))` to ensure correct ESM path resolution across all operating systems and terminal environments.
* **Typed API responses:** every JSON endpoint passes its body through `typedJson(c, schema, body, status)` (`backend/src/util/typed.ts`), which validates the shape against the matching `@nvcal/domain` response schema. A handler whose response drifts from its declared contract returns 500 rather than leaking a malformed payload.
