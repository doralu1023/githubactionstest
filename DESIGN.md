# AI-Readable Design Report: `githubactionstest`

> **Purpose:** Single document for AI agents and engineers describing repository layout, runtime architecture, data flows, and cross-file contracts.  
> **Scope:** Entire project folder **excluding** `node_modules/` and `.git/` (dependencies listed by name only).

---

## 1. Project snapshot

```yaml
name: githubactionstest
type: monolithic_spike
primary_stack:
  frontend: static HTML + vanilla JS + CSS
  backend: Node.js (Express 5)
  ci: GitHub Actions (workflow_dispatch)
  desktop_windows: Go 1.21 (Edge app-mode launcher)
  desktop_mac_template: Swift + Cocoa + WKWebView (built in alternate workflow)
runtime_ports:
  local_server: 3000
auth: none  # demo RBAC in browser only
persistence:
  browser: in-memory (uploaded tools lost on reload)
  server: in-memory Map for build jobs only
package_manager: npm
```

---

## 2. Source tree (authoritative)

Paths are relative to repository root `githubactionstest/`.

```text
.github/workflows/
  build.yml          # Triggered by server — Windows .exe only (Yahoo runners)
  build_mac.yml      # Full Mac + Win on public runners; NOT wired from server.js
  blank.yml          # Starter CI (echo) on push/PR main
.agents/skills/      # Cursor/agent skill packs (impeccable family + scripts)
  {bolder,clarify,critique,impeccable,layout,optimize,polish,shape}/SKILL.md + reference/
template/
  AppTemplate.swift   # macOS .app payload: WKWebView shell + injected JS hooks
winapp/
  main.go             # Windows: decode base64 HTML to TEMP; launch msedge --app
  go.mod
sandbox_v3.html       # SPA shell, loads main.js + style.css
main.js               # All client logic (roles, upload, analysis, queue, build polling)
main.js.design.md     # File-scoped design doc for main.js only
style.css             # Design tokens, layout, components
server.js             # Express API + static + GitHub dispatch + callback
package.json          # axios, dotenv, express
skills-lock.json      # Pinned skill digests from pbakaus/impeccable
.impeccable.md        # UX/design context for the sandbox UI
README.md             # Minimal title only
.env                  # Local secrets (not documented here; see §8)
```

**Intentionally omitted from tree:** `node_modules/`, `.git/`, lockfile internals.

---

## 3. System architecture

```mermaid
flowchart LR
  subgraph browser [Browser]
    HTML[sandbox_v3.html]
    JS[main.js]
    HTML --> JS
  end
  subgraph server [Node server.js :3000]
    API[/api/package]
    CB[/api/build-complete]
    POLL[/api/build-status]
    STATIC[Static file root]
  end
  subgraph gh [GitHub]
    GA[Actions workflow_dispatch]
    ART[Artifacts]
  end
  JS -->|POST html + tool name| API
  API -->|Bearer PAT| GA
  GA --> ART
  GA -->|curl callback| CB
  JS -->|poll| POLL
  CB -->|updates| POLL
```

**Build path actually used in this repo:** `server.js` dispatches **`.github/workflows/build.yml`** only (Windows job + notify). **`build_mac.yml`** defines macOS + Windows on `ubuntu-latest` / `macos-latest` but is not referenced by the Node server.

---

## 4. Subsystems

### 4.1 Frontend (`sandbox_v3.html`, `style.css`, `main.js`)

| Concern | Implementation |
|---------|----------------|
| **Chrome** | Sticky top nav, role switcher (`select`), step pills (6 steps), two-column grid, cards |
| **RBAC** | `ROLES` object: supplier, reviewer, admin, user — toggles sections, upload/approve/download, step visibility |
| **Upload** | `.html`/`.htm`, max 10mb; `FileReader` → `sanitizeHTML` → `analyzeHTML` → `uploadedTools[]` with `status: pending` |
| **Sanitizer** | `sanitizeHTML`: `DOMParser`, strip subset of tags, rebuild with CSP meta; `SANITIZER_CONFIG` partially reflects intended policy (see `main.js.design.md` §8). **Preview and shipped HTML use the same post-sanitize document and CSP** — no alternate “preview-only” profile (see §7). |
| **Analysis** | Heuristic static analysis (DOCTYPE, external scripts, unsafe patterns, storage, frame escape) → risk tier |
| **Preview** | Blob URL + `iframe#sandboxFrame` + CSP injection; sandbox attrs `allow-scripts allow-forms allow-modals` |
| **Approval** | Table queue + modal; approve/reject mutates status; audit `console.info` only |
| **Package** | `POST /api/package` with selected **approved** tool HTML; progress log; poll until `done` |
| **Styling** | CSS variables (`--red`, `--gray-*`, `--radius`, shadows); cards, `info-box`, `check-item`, log panels |

Global functions exposed for HTML `onclick`: `switchRole`, `runAnalysis`, `openModal`, `closeModal`, `approveTool`, `rejectTool`, `previewTool`, `buildPackage`, `downloadApp`.

### 4.2 Backend (`server.js`)

| Route | Method | Behavior |
|-------|--------|-----------|
| `/` | GET | Serves `sandbox_v3.html` (via `sendFile` + `express.static(__dirname)`) |
| `/api/package` | POST | JSON `htmlContent`, `toolName` — `bundleScripts` inlines external `https?` script tags; base64; `workflow_dispatch` to `build.yml`; registers `buildJobs[jobId]` pending |
| `/api/build-complete` | POST | Header `x-callback-secret` must match `CALLBACK_SECRET`; body `jobId`, `runId`; lists run artifacts; updates job with `macArtifactId`, `winArtifactId`, `actionsUrl` |
| `/api/build-status/:jobId` | GET | Returns pending or done + artifact IDs + Actions URL |

**Bundling:** Regex replaces `<script src="http(s)://...">` with inline `<script>...</script>` so CI embeds a single self-contained HTML string (subject to fetch success).

### 4.3 Windows artifact (`winapp/main.go`)

- **Build:** `sed` substitutes `__HTML_CONTENT_PLACEHOLDER__` with **base64 string literal** (same line as token in generated `temp_main.go`).
- **Runtime:** Decode base64 → write `%TEMP%\twec_tool_live.html` → `cmd /c start msedge --app=<path>` (no embedded browser binary; depends on Edge).

### 4.4 macOS template (`template/AppTemplate.swift`)

- Cocoa `NSApplication` + `WKWebView`; base64 HTML injected at build time (in `build_mac.yml` flow).
- User scripts: bridge `nativeDownload` / `jslog`; intercept blob/data downloads for native handling.
- Packaged as `.app` + zipped in `build_mac.yml` (artifact name `${tool_name}-mac`).

### 4.5 GitHub Actions

#### `build.yml` (production path for this spike)

```yaml
trigger: workflow_dispatch
inputs: html_base64, tool_name, job_id, callback_url
jobs:
  build-windows:
    runs-on: yahoo-enterprise-ubuntu-x86
    steps: checkout, internal node@20, install Go 1.21 tarball, sed + GOOS=windows build winapp
    artifact: {tool}-windows -> dist/{tool}.exe
  notify:
    needs: [build-windows]
    runs-on: yahoo-enterprise-ubuntu-x86
    step: curl POST callback_url with X-Callback-Secret and jobId/runId
```

**Note:** No macOS job; `server.js` still looks for `${toolName}-mac` artifact — will be missing for this workflow.

#### `build_mac.yml` (alternate / not server-triggered)

- Jobs: `build-mac` (`macos-latest`, Swift template → `.app.zip`), `build-windows` (`ubuntu-latest`, Go), `notify` needs both.
- Uses `ubuntu-latest` / `macos-latest` — suitable for public GitHub; differs from `build.yml` runners.

#### `blank.yml`

- CI on push/PR to `main`: checkout + echo scripts (template only).

### 4.6 Agent / design collateral

| Artifact | Role |
|----------|------|
| `.agents/skills/*` | Discrete **Cursor skills** (critique, impeccable, layout, etc.) — instructions + references for UI/product work; not executed at app runtime |
| `skills-lock.json` | Versioned hashes pinning skill copies to GitHub source `pbakaus/impeccable` |
| `.impeccable.md` | Product/design principles for the sandbox (roles, workflow honesty, tokens, `#e60012` accent) |

---

## 5. End-to-end data flow (happy path)

1. User uploads HTML in browser → sanitize + analyze → tool row `pending`.
2. Reviewer/admin opens modal → approve → `approved`.
3. Role with `canDownload` selects tool → **Build** → browser `POST /api/package`.
4. Server bundles remote scripts, base64 payload, dispatch `build.yml`.
5. Windows job produces artifact `{name}-windows`.
6. `notify` POSTs `/api/build-complete` with shared secret.
7. Browser polls `/api/build-status/:jobId` → UI shows link to GitHub Actions run (download UX partially demo; `lastDownloadUrl` variables in `main.js` may be unset).

---

## 6. Cross-file contracts

| Consumer | Expects | Provider |
|----------|---------|----------|
| `server.js` GA API | `GITHUB_REPO`, `GITHUB_TOKEN`, `SERVER_URL` | `.env` |
| Callback | `CALLBACK_SECRET` header | GitHub secret `CALLBACK_SECRET` in workflow |
| `build-complete` | Artifact names `${tool_name}-windows` and `${tool_name}-mac` | Workflow uploads — **mac missing in `build.yml`** |
| `main.js` | REST JSON shapes `{ jobId }`, `{ status, actionsUrl, ... }` | `server.js` |
| Workflows | `html_base64` fits in `sed` substitution / CLI limits | Caller (very large HTML may break `workflow_dispatch` input limits) |

---

## 7. Security model (as implemented)

- **Preview and packaged output must match:** The product does **not** maintain two sanitization or CSP specifications. The HTML shown in sandbox preview (blob URL in `iframe#sandboxFrame`) and the HTML carried into the approval queue, sanitize-and-download output, and packaged artifacts (e.g. base64-in-`.exe` / WKWebView payloads) are the **same** post-`sanitizeHTML` document, including the same injected `Content-Security-Policy` meta. Reviewers therefore exercise the same runtime constraints as end users; any CSP or strip rule must be chosen so that behavior is acceptable in **both** preview and offline or packaged execution.
- **Not production-ready:** No user authentication; role switcher is cosmetic.
- **Client-side:** Sanitization + CSP + iframe sandbox reduce naive XSS exfiltration; analysis is advisory.
- **Server:** Callback protected by shared secret; GitHub token used server-side only (if configured).
- **Binary distribution:** HTML embedded as base64 inside `.exe` template; Edge launches local file — tool content not in URL bar but is on disk under TEMP.

---

## 8. Configuration (environment variables)

Read by `server.js` via `dotenv`:

| Variable | Usage |
|----------|--------|
| `CALLBACK_SECRET` | Validates GitHub callback requests |
| `GITHUB_TOKEN` | `Authorization: Bearer` for Actions API + artifacts |
| `GITHUB_REPO` | `owner/name` string for REST paths |
| `SERVER_URL` | Public base URL for `callback_url` input (must reach dev machine or deployed host from GitHub) |

Do not commit real tokens; `.env` is local-only.

---

## 9. Known inconsistencies / tech debt

1. **Two workflow files** with different runners and job matrices; only **`build.yml`** is dispatched from the app.
2. **Mac artifact** expected in `server.js` callback is absent when using `build.yml`.
3. **UI copy** (sanitize card, download panel) describes behaviors not fully wired (`downloadApp` vs build completion, signed URLs “demo”).
4. **`main.js`** contains ZIP helpers (`buildSimpleZip`, `crc32`) unused by current flow.
5. **README.md** is a single heading — no run instructions in repo.

---

## 10. How to run (operational, not in README)

```bash
cd githubactionstest
npm install
# configure .env
node server.js
# open http://localhost:3000
```

GitHub Actions packaging requires valid `GITHUB_*` credentials, repository access, and reachable `SERVER_URL` for the callback from GitHub’s network.

---

## 11. Related documentation files

| File | Content |
|------|---------|
| `DESIGN.md` | **This file** — whole-folder architecture |
| `main.js.design.md` | Deep dive for `main.js` only |
| `.impeccable.md` | UX/design intent for the sandbox UI |

---

*Document generated for machine parsing; update when workflows or server dispatch targets change.*
