# Design Report: `main.js`

> **Audience:** AI agents and engineers.  
> **Scope:** This file only (no product roadmap).  
> **Runtime:** Browser bundle loaded by `sandbox_v3.html` (no module system; symbols are global for `onclick` handlers).

---

## 1. File metadata

```yaml
file: main.js
language: javascript
environment: browser
dependencies:
  - DOM APIs: DOMParser, FileReader, Blob, URL, fetch, setInterval
  - implicit_html: sandbox_v3.html (element IDs, onclick wiring)
persistence: none (in-memory only; reload clears state)
```

---

## 2. Purpose

Single-page application logic for an **AI Tool Sandbox demo**: role-based UI, HTML upload with client-side sanitization and static analysis, approval queue, simulated packaging UI that calls a local Express server (`/api/package`, `/api/build-status/:jobId`), optional ZIP utilities, and toast/step UX.

---

## 3. Global state

| Symbol | Type | Description |
|--------|------|---------------|
| `ROLES` | `const` object | RBAC matrix: labels, flags, visible step indices, allowed card section IDs |
| `currentRole` | `string` | Key into `ROLES`; default `'admin'` |
| `uploadedTools` | `Array<Tool>` | All uploaded tools in session |
| `currentToolId` | `string \| null` | Tool id open in approval modal |
| `currentBlobURL` | `string \| null` | Object URL for sandbox iframe; revoked before replace |
| `lastDownloadUrl` | `string` | Intended mac download URL (set elsewhere if used) |
| `lastWinDownloadUrl` | `string` | Intended windows download URL (set elsewhere if used) |

### 3.1 Tool record (`uploadedTools[]` entries)

```yaml
Tool:
  id: string
  name: string
  content: string
  risk: enum [low, medium, high]
  status: enum [pending, approved, rejected]
  uploadedBy: string
  analysisResult:
    checks: object  # keys: size, mime, ext, eval, cookie, escape
    log: string[]  # HTML fragments for innerHTML
    risk: string   # duplicate of top-level risk
```

---

## 4. `ROLES` specification

Each role defines:

- `label`, `email` (display only)
- `canUpload`, `canApprove`, `canDownload` (capability booleans)
- `visibleSteps`: step pill indices `1..6` shown
- `allowedSections`: subset of `uploadCard`, `sanitizeCard`, `approvalCard`, `packageCard`

```yaml
supplier:
  canUpload: true
  canApprove: false
  canDownload: false
  visibleSteps: [1, 2, 3]
  allowedSections: [uploadCard, sanitizeCard, approvalCard]
reviewer:
  canUpload: false
  canApprove: true
  canDownload: false
  visibleSteps: [2, 3, 4]
  allowedSections: [sanitizeCard, approvalCard]
admin:
  canUpload: true
  canApprove: true
  canDownload: true
  visibleSteps: [1, 2, 3, 4, 5, 6]
  allowedSections: [uploadCard, sanitizeCard, approvalCard, packageCard]
user:
  canUpload: false
  canApprove: false
  canDownload: true
  visibleSteps: [6]
  allowedSections: [packageCard]
```

**Special UI behavior:** When `currentRole === 'user'`, `applyRoleUI` hides step pills, moves `packageCard` to top of `.page`, and shows `userToolList`.

**Queue filtering:** If `currentRole === 'supplier'`, `refreshQueue` only lists tools where `uploadedBy === ROLES.supplier.label`.

---

## 5. DOM contract (required element IDs)

Functions assume these IDs exist (from `sandbox_v3.html`):

- **Role / nav:** `currentUserLabel`, `roleBadgeChip`, `roleSelect` (init only)
- **Steps:** `step1` … `step6`, `stepPills`
- **Layout:** `.page`, `.grid-2`, optional `[data-pkg-anchor]`
- **Upload:** `uploadZone`, `fileInput`, `uploadProgress`, `uploadStatus`, `roleNotice-upload`
- **Sanitize:** `sanitizeLog`, `sanitizeSummary`
- **Analysis:** `chk-size`, `chk-mime`, `chk-ext`, `chk-eval`, `chk-cookie`, `chk-escape`, `analysisLog`, `runAnalysisBtn`
- **Sandbox:** `sandboxFrame`, `sandboxPlaceholder`
- **Queue:** `queueBody`, `roleNotice-approve`
- **Modal:** `approveModal`, `modalMsg`
- **Package:** `packageCard`, `roleNotice-download`, `buildBtnWrap`, `toolSelect`, `buildBtn`, `userToolList`, `buildLog`, `buildProgress`, `dlPanel`, `dlMac`, `dlWin`, `dlMacBtn`, `dlWinBtn`, `dlMacToken`, `dlWinToken`
- **Toast:** `toast`

**Global functions referenced from HTML:** `switchRole`, `runAnalysis`, `openModal`, `closeModal`, `approveTool`, `rejectTool`, `previewTool`, `buildPackage`, `downloadApp` — all must remain on `window` (no `export`).

---

## 6. Function catalog (by section)

### 6.1 Role and layout

| Function | Responsibility |
|----------|----------------|
| `switchRole(role)` | Sets `currentRole`, updates label/chip, calls `applyRoleUI`, toast |
| `applyRoleUI()` | Toggles steps/cards visibility, upload zone disabled state, notices, queue, tool select, user package layout |
| `setRoleNotice(zone, msg)` | Writes `roleNotice-{upload\|approve\|download}`; adds `danger` class if message starts with 🚫 |

### 6.2 Upload pipeline

| Function | Responsibility |
|----------|----------------|
| `handleFiles(files)` | Permission check, extension/size filter, `FileReader` per file, `sanitizeHTML` → `analyzeHTML` → push `Tool` with `status: 'pending'`, updates logs/progress, `refreshQueue` / `refreshToolSelect` / `showAnalysis` / `showSandbox` / `advanceStep` |

Event listeners: `uploadZone` drag/drop, `fileInput` change.

### 6.3 Analysis

| Function | Responsibility |
|----------|----------------|
| `analyzeHTML(html, filename)` | Heuristic checks (DOCTYPE, external scripts, unsafe strings, storage/cookie, frame escape); computes `risk`; returns `{ checks, log, risk }` |
| `showAnalysis(result)` | Maps checks to `#chk-*` DOM classes and icons; fills `analysisLog`; enables `runAnalysisBtn`; `advanceStep(2)` |
| `runAnalysis()` | Re-runs analysis on last uploaded tool; toast |

### 6.4 Sanitization

| Symbol | Responsibility |
|--------|----------------|
| `SANITIZER_CONFIG` | Declares forbidden tags, safe attrs, URL attrs, schemes (intended policy; not fully applied in `sanitizeHTML`) |
| `sanitizeHTML(html)` | `DOMParser` → remove selected tags → rebuild document with injected CSP meta in `<head>` → returns `{ html, strips, log }` (see §8) |

### 6.5 Sandbox preview

| Function | Responsibility |
|----------|----------------|
| `showSandbox(html)` | Revokes prior blob URL; optional CSP injection if missing; creates Blob URL; assigns `sandboxFrame.src`; `advanceStep(3)` |

### 6.6 Approval queue and modal

| Function | Responsibility |
|----------|----------------|
| `refreshQueue()` | Renders `queueBody` rows with risk/status badges; Review/Preview buttons per role rules; `advanceStep(4)` |
| `previewTool(id)` | Loads tool content into sandbox; toast |
| `openModal(id)` | Requires `canApprove`; sets `currentToolId`, modal text, sandbox preview, opens modal |
| `closeModal()` | Clears modal state |
| `approveTool()` | Sets tool `approved`; `console.info` audit line; refresh |
| `rejectTool()` | Sets tool `rejected`; audit log; refresh |

### 6.7 Packaging and polling

| Function | Responsibility |
|----------|----------------|
| `approvedTools()` | Filters `uploadedTools` where `status === 'approved'` |
| `renderUserToolList()` | For `user` role only, lists approved tools in `userToolList` |
| `refreshToolSelect()` | Populates `toolSelect` from `approvedTools()`; disables per role |
| `buildPackage()` | Permission + selected tool; logs to `buildLog`; `POST /api/package`; `pollBuildStatus`; on error updates log/toast |
| `pollBuildStatus(jobId, buildLog, prog)` | 5s interval, max 60 attempts; polls `GET /api/build-status/:jobId`; on `done` advances steps 5–6 |

### 6.8 Download helpers (partial / demo)

| Function | Responsibility |
|----------|----------------|
| `downloadApp(platform)` | If `lastWinDownloadUrl` / `lastDownloadUrl` set, navigates `window.location`; else toast to build first |
| `buildSimpleZip(files)` | Store-only ZIP binary construction |
| `concatUint8`, `crc32` | ZIP support utilities |

### 6.9 UI utilities

| Function | Responsibility |
|----------|----------------|
| `advanceStep(n)` | Updates `step1`…`step6` classes: `done` / `active` / default |
| `toast(msg)` | Shows transient toast element |
| `escapeHTML(str)` | Entity-escape for safe text insertion |

### 6.10 Init

`DOMContentLoaded`: sync `#roleSelect` to `currentRole`, `applyRoleUI()`.

---

## 7. Control flow (high level)

```text
Upload → sanitizeHTML → analyzeHTML → Tool(pending) → refreshQueue
                                              ↓
                    Reviewer/Admin: openModal → approve/reject
                                              ↓
                    approvedTools → refreshToolSelect
                                              ↓
                    buildPackage → POST /api/package → pollBuildStatus → UI log + steps
```

---

## 8. Implementation notes / drift (for maintainers)

1. **`sanitizeHTML` vs `SANITIZER_CONFIG` / UI copy:** Config documents a broad strip policy; the implemented `sanitizeHTML` rebuilds HTML with a subset of tag removal and always returns `strips: 0` and `log: []`. Upload path still branches on `sanitResult.strips` for toasts/UI — those paths rarely fire.
2. **`buildPackage` completion:** Advances steps and appends Actions link text; does not set `lastDownloadUrl` / `lastWinDownloadUrl` in the shown flow, so `downloadApp` may no-op unless other code assigns them.
3. **`buildSimpleZip` / `crc32`:** Present but not referenced by upload/build flow in this file (dead or reserved for future demo).
4. **Security:** Analysis flags are informational; enforcement is preview CSP + iframe sandbox + sanitization layer as implemented.

---

## 9. External I/O

| Call | Method | Endpoint | Body / notes |
|------|--------|----------|--------------|
| Trigger build | `fetch` POST | `/api/package` | `{ toolName, htmlContent }` JSON |
| Poll status | `fetch` GET | `/api/build-status/:jobId` | Expects `{ status, ... }` |

No authentication headers; same-origin assumed with `server.js`.

---

## 10. Extension points (structural)

- New role: extend `ROLES` + `applyRoleUI` branches (e.g. supplier filter, user layout).
- New tool state: extend `status` handling in `refreshQueue`, `approvedTools`, `renderUserToolList`, `refreshToolSelect`.
- New pipeline stage: add step pill + `advanceStep` calls + card section ID in HTML and `allowedSections`.
- Stricter sanitization: implement logic inside `sanitizeHTML` (or replace with library) and align return shape `{ strips, log }` with existing UI consumers.

---

*Generated as a machine-readable design snapshot of `main.js`.*
