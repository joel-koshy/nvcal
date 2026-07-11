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

## 5. Preact Directory Structure
```text
nvcal-preact/
├── src/
│   ├── panes/         
│   │   ├── SidebarMonth.tsx  # Fixed-width mini-month view grid
│   │   ├── MainWeek.tsx      # Fluid 24-hour time gutter and week view
│   │   └── EventDialog.tsx   # Floating interactive island pane for event creation
│   ├── hooks/
│   │   └── vim/              # Global keyboard router ecosystem
│   │       ├── VimProvider.tsx # State machine and 2D spatial routing engine
│   │       ├── usePane.ts      # Hook to register local layout geometry 
│   │       └── useNavigable.ts # Hook to attach elements to the Vim registry
│   ├── utils/              
│   │   └── dates.ts          # Native JS Date math (leap years, month boundaries)
│   ├── app.tsx               # Root layout holding state and applying CSS grid
│   ├── index.css             # Global minimalist terminal-aesthetic CSS
│   └── main.tsx              # Preact DOM render entry point
├── vite.config.ts            # Configured with fileURLToPath for bulletproof aliases
└── index.html                # The dry shell containing the empty favicon```

## 6. Key Implementation Details
* **VIM Navigation Engine:** Navigation is entirely decoupled from the DOM structure using a global Context provider. Using usePane(), components define localized cols, flow, and neighbors. The engine dynamically calculates a mathematical (X, Y) coordinate map for the UI.
    Micro-Navigation (h,j,k,l): Moves the cursor sequentially through the 2D coordinate map, featuring row-wrapping logic. 
    Macro-Navigation (Shift + H,J,K,L): Jumps between adjacent layout panes using the defined neighbors graph.
* The "Wormhole" and "Island Pane" Patterns: The EventDialog is registered as a functioning pane (so j/k works on the inputs) but defines an empty neighbor map (neighbors: {}), making it an "Island." It cannot be reached by macro-navigation. Instead, components use the "Wormhole Pattern," utilizing
* **Bulletproof Path Aliasing:** In `vite.config.ts`, the `@` alias is defined using `fileURLToPath(new URL('./src', import.meta.url))` to ensure correct ESM path resolution across all operating systems and terminal environments.
