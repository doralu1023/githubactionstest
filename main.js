/* ════════════════════════════════════════════════
   UI FEATURE FLAGS (production vs engineer)
   ?dev=1       — full UI, top nav chrome, roles, package workflow
   ?dev=0       — turn dev UI off (same as a clean URL)
   Clean URL    — slim internal user review UI (no role/user badge in nav)
════════════════════════════════════════════════ */
const UI_FEATURES_STORAGE_KEY = 'ats-ui-features'

function clearUiFeaturesStorage() {
  try {
    localStorage.removeItem(UI_FEATURES_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
}

function persistUiFeatures(flags) {
  try {
    localStorage.setItem(UI_FEATURES_STORAGE_KEY, JSON.stringify(flags))
  } catch {
    /* storage unavailable */
  }
}

/** @returns {boolean|null} true = on, false = off, null = param not set */
function parseDevQueryValue(raw) {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (v === '1' || v === 'true') return true
  if (v === '0' || v === 'false' || v === '') return false
  return null
}

function parseUiFeatures() {
  const params = new URLSearchParams(window.location.search)
  const slim = { devMode: false }

  if (params.has('dev')) {
    const mode = parseDevQueryValue(params.get('dev'))
    if (mode === true) {
      const flags = { devMode: true }
      persistUiFeatures(flags)
      return flags
    }
    clearUiFeaturesStorage()
    return slim
  }

  if (params.has('devMode')) {
    const mode = parseDevQueryValue(params.get('devMode'))
    if (mode === true) {
      const flags = { devMode: true }
      persistUiFeatures(flags)
      return flags
    }
    clearUiFeaturesStorage()
    return slim
  }

  try {
    const stored = localStorage.getItem(UI_FEATURES_STORAGE_KEY)
    if (!stored) return slim
    const parsed = JSON.parse(stored)
    return parsed?.devMode === true ? { devMode: true } : slim
  } catch {
    clearUiFeaturesStorage()
    return slim
  }
}

let uiFeatures = parseUiFeatures()
let appReady = false

function refreshUiFromLocation() {
  uiFeatures = parseUiFeatures()
  if (!appReady) return
  applyRoleUI()
}

function isSlimUI() {
  return !uiFeatures.devMode
}

function showDesktopPackageUI() {
  return uiFeatures.devMode
}

/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
const ROLES = {
  internalUser: {
    label: 'Internal User',
    email: 'internaluser@vendor.com',
    canUpload: true,
    canApprove: false,
    canDownload: false,
    visibleSteps: [1, 2, 3],
    allowedSections: ['uploadCard', 'sanitizeCard', 'approvalCard'],
  },
  reviewer: {
    label: 'Reviewer',
    email: 'reviewer@company.com',
    canUpload: false,
    canApprove: true,
    canDownload: false,
    visibleSteps: [2, 3, 4],
    allowedSections: ['sanitizeCard', 'approvalCard'],
  },
  admin: {
    label: 'Admin',
    email: 'admin@company.com',
    canUpload: true,
    canApprove: true,
    canDownload: true,
    visibleSteps: [1, 2, 3, 4, 5, 6],
    allowedSections: ['uploadCard', 'sanitizeCard', 'approvalCard', 'packageCard'],
  },
  user: {
    label: 'End User',
    email: 'user@company.com',
    canUpload: false,
    canApprove: false,
    canDownload: true,
    visibleSteps: [6],
    allowedSections: ['packageCard'],
  },
}

/** Set after Okta session is loaded from GET /api/auth/me */
let authSession = null

let currentRole = 'internalUser'
let uploadedTools = []
let currentToolId = null
let currentBlobURL = null

// Sanitize-only results: [{ name, content, sanitResult }]
let sanitizeOnlyResults = []

/* ════════════════════════════════════════════════
   OKTA AUTH (session via /api/auth/me)
════════════════════════════════════════════════ */
function canSwitchRoles() {
  return authSession?.canSwitchRoles === true || uiFeatures.devMode === true
}

async function initAuth() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' })
    if (!res.ok) throw new Error(`auth ${res.status}`)
    authSession = await res.json()
  } catch {
    authSession = {
      authenticated: false,
      provider: 'okta',
      email: '',
      name: 'Guest',
      canSwitchRoles: false,
      defaultAppRole: 'internalUser',
      primaryRole: 'internalUser',
    }
  }
}

function getLockedAppRole() {
  return authSession?.defaultAppRole || 'internalUser'
}

function updateUserChrome() {
  const r = ROLES[currentRole]
  if (!r) return

  const label = document.getElementById('currentUserLabel')
  if (label) {
    if (authSession?.name && authSession?.email) {
      label.textContent = `${authSession.name} — ${authSession.email}`
    } else {
      label.textContent = `${r.label} — ${r.email}`
    }
  }

  const chip = document.getElementById('roleBadgeChip')
  if (chip) {
    if (canSwitchRoles()) {
      chip.textContent = r.label.toUpperCase()
      chip.className = 'role-chip role-chip--' + currentRole
    } else {
      chip.textContent = (authSession?.primaryRole || 'internalUser').toUpperCase()
      chip.className = 'role-chip role-chip--' + (authSession?.primaryRole || 'internalUser')
    }
  }
}

function setTopNavBlockHidden(el, hidden) {
  if (!el) return
  if (hidden) {
    if (el.contains(document.activeElement)) document.activeElement.blur()
    el.hidden = true
    el.setAttribute('inert', '')
  } else {
    el.hidden = false
    el.removeAttribute('inert')
    el.removeAttribute('aria-hidden')
  }
}

function configureTopNavChrome() {
  const switcher = document.getElementById('roleSwitcher')
  const userBadge = document.getElementById('userBadge')
  const sel = document.getElementById('roleSelect')

  if (!uiFeatures.devMode) {
    setTopNavBlockHidden(switcher, true)
    setTopNavBlockHidden(userBadge, true)
    if (sel) sel.tabIndex = -1
    return
  }

  setTopNavBlockHidden(userBadge, false)

  if (!switcher) return

  if (canSwitchRoles()) {
    switcher.hidden = false
    switcher.removeAttribute('inert')
    switcher.removeAttribute('aria-hidden')
    if (sel) sel.tabIndex = 0
  } else {
    if (sel && document.activeElement === sel) sel.blur()
    switcher.hidden = true
    switcher.setAttribute('inert', '')
    if (sel) sel.tabIndex = -1
  }
}

/* ════════════════════════════════════════════════
   ROLE SWITCHER (admin / Okta privileged users only)
════════════════════════════════════════════════ */
function switchRole(role, silent) {
  if (!canSwitchRoles()) {
    role = getLockedAppRole()
  }
  if (!ROLES[role]) return

  currentRole = role
  updateUserChrome()

  const sel = document.getElementById('roleSelect')
  if (sel && sel.value !== role) sel.value = role

  applyRoleUI()
  if (!silent && canSwitchRoles()) toast(`Switched to role: ${ROLES[role].label}`)
}

function configureRoleSelect() {
  if (!canSwitchRoles()) return

  const sel = document.getElementById('roleSelect')
  if (!sel) return
  const full = uiFeatures.devMode
  ;['internalUser', 'reviewer', 'admin', 'user'].forEach((role) => {
    const opt = sel.querySelector(`option[value="${role}"]`)
    if (!opt) return
    const allowed = full || role === 'internalUser' || role === 'admin'
    opt.hidden = !allowed
    opt.disabled = false
  })
  if (!full && !['internalUser', 'admin'].includes(currentRole)) {
    switchRole('internalUser', true)
  }
}

function applyProductionUI() {
  const slim = isSlimUI()
  const showDesktop = showDesktopPackageUI()
  document.body.classList.toggle('ui-slim', slim)
  document.body.classList.toggle('ui-dev', uiFeatures.devMode)

  document.querySelectorAll('[data-ui-full-only]').forEach((el) => {
    el.style.display = slim ? 'none' : ''
  })

  const modeSystem = document.getElementById('modeSystem')
  if (modeSystem && slim) {
    const sanitizeRadio = document.getElementById('modeSanitize')
    if (sanitizeRadio) sanitizeRadio.checked = true
    const desc = document.getElementById('modeDescription')
    if (desc) desc.innerHTML = MODE_DESC.sanitize
    resetSanitizeDlSection()
  }

  const reviewHeading = document.getElementById('reviewLaneHeading')
  if (reviewHeading) reviewHeading.style.display = slim ? 'none' : ''

  configureTopNavChrome()
  configureRoleSelect()
}

function applyRoleUI() {
  const r = ROLES[currentRole]
  const slim = isSlimUI()
  const showDesktop = showDesktopPackageUI()

  applyProductionUI()

  const stepPills = document.getElementById('stepPills')
  if (stepPills) {
    if (slim) {
      stepPills.style.display = 'none'
    } else if (currentRole === 'user') {
      stepPills.style.display = 'none'
    } else {
      stepPills.style.display = ''
      for (let i = 1; i <= 6; i++) {
        const el = document.getElementById('step' + i)
        if (el) el.style.display = r.visibleSteps.includes(i) ? '' : 'none'
      }
    }
  }

  const allSections = ['uploadCard', 'sanitizeCard', 'securityCard', 'approvalCard', 'packageCard']
  allSections.forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    if (slim) {
      const visible = ['uploadCard', 'sanitizeCard', 'securityCard']
      if (showDesktop && id === 'packageCard') visible.push('packageCard')
      el.style.display = visible.includes(id) ? '' : 'none'
      return
    }
    if (id === 'securityCard') {
      el.style.display = ''
      return
    }
    el.style.display = r.allowedSections.includes(id) ? '' : 'none'
  })

  const page = document.querySelector('.page')
  const pkgCard = document.getElementById('packageCard')
  const grid = document.querySelector('.grid-2')
  if (!slim && currentRole === 'user') {
    if (stepPills) stepPills.style.display = 'none'
    page.insertBefore(pkgCard, page.firstChild)
    pkgCard.style.marginTop = '0'
  } else if (!slim && pkgCard) {
    if (stepPills) stepPills.style.display = ''
    if (pkgCard.previousElementSibling !== grid) {
      if (grid && grid.nextSibling) page.insertBefore(pkgCard, grid.nextSibling)
    }
    pkgCard.style.marginTop = '24px'
  }

  const canUp = r.canUpload
  ;['folderBtnLabel', 'fileBtnLabel'].forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.style.opacity = canUp ? '1' : '.45'
    el.style.pointerEvents = canUp ? 'auto' : 'none'
  })
  const modeWrap = document.getElementById('uploadModeWrap')
  if (modeWrap) modeWrap.style.display = canUp ? '' : 'none'

  const uploadNotice = document.getElementById('roleNotice-upload')
  if (uploadNotice) {
    uploadNotice.style.display = slim && currentRole !== 'admin' ? 'none' : ''
  }
  setRoleNotice(
    'upload',
    canUp
      ? '✅ You have permission to upload tools.'
      : `🚫 Your role (${r.label}) cannot upload tools.`
  )

  const approvalCard = document.getElementById('approvalCard')
  if (approvalCard && !slim) {
    setRoleNotice(
      'approve',
      r.canApprove
        ? '✅ You can approve or reject tools in the queue.'
        : `🚫 Your role (${r.label}) cannot approve tools.`
    )
    refreshQueue()
  }

  const pkgVisible = !slim || showDesktop
  const downloadNotice = document.getElementById('roleNotice-download')
  if (downloadNotice) downloadNotice.style.display = pkgVisible ? '' : 'none'
  if (pkgVisible) {
    setRoleNotice(
      'download',
      r.canDownload
        ? '✅ You can download packaged desktop apps.'
        : `🚫 Your role (${r.label}) cannot download packages.`
    )
  }

  const buildBtnWrap = document.getElementById('buildBtnWrap')
  const buildBtn = document.getElementById('buildBtn')
  if (buildBtnWrap) buildBtnWrap.style.display = r.canDownload && pkgVisible ? '' : 'none'
  if (buildBtn) buildBtn.disabled = !r.canDownload || approvedTools().length === 0
  refreshToolSelect()
  renderUserToolList()
}

function setRoleNotice(zone, msg) {
  const el = document.getElementById(`roleNotice-${zone}`)
  if (!el) return
  el.textContent = msg
  el.className = 'info-box' + (msg.startsWith('🚫') ? ' danger' : '')
  el.style.marginBottom = '14px'
}

function approvedTools() {
  return uploadedTools.filter((t) => t.status === 'approved')
}

function renderUserToolList() {
  const wrap = document.getElementById('userToolList')
  if (!wrap) return
  const tools = approvedTools()
  if (currentRole !== 'user') {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  if (tools.length === 0) {
    wrap.innerHTML =
      '<p style="color:var(--gray-5);font-size:.85rem;text-align:center;padding:16px 0;">No approved tools available yet.</p>'
    return
  }
  wrap.innerHTML = tools
    .map(
      (t) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-3);">
      <div>
        <strong style="font-size:.85rem;">${escapeHTML(t.name)}</strong>
        <span class="badge badge-green" style="margin-left:8px;">Approved</span>
      </div>
      <span style="font-size:.75rem;color:var(--gray-5);">Risk: ${t.risk}</span>
    </div>`
    )
    .join('')
}

/* ════════════════════════════════════════════════
   MODE TOGGLE
════════════════════════════════════════════════ */
const MODE_DESC = {
  sanitize:
    '<strong>Sanitize &amp; Download:</strong> Files are sanitized locally and returned as clean downloads. They are <em>not</em> submitted to the approval queue.',
  system:
    '<strong>Upload to System:</strong> After sanitization, tools are added to the approval queue for reviewer sign-off before packaging.',
}

document.querySelectorAll('input[name="uploadMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const desc = document.getElementById('modeDescription')
    if (desc) desc.innerHTML = MODE_DESC[radio.value] || ''
    // Clear leftover download section on mode switch
    resetSanitizeDlSection()
  })
})

function getUploadMode() {
  if (isSlimUI()) return 'sanitize'
  const checked = document.querySelector('input[name="uploadMode"]:checked')
  return checked ? checked.value : 'sanitize'
}

function resetSanitizeDlSection() {
  sanitizeOnlyResults = []
  const sec = document.getElementById('sanitDlSection')
  if (sec) sec.style.display = 'none'
  const list = document.getElementById('sanitDlList')
  if (list) list.innerHTML = ''
  const publishPanel = document.getElementById('publishPanel')
  if (publishPanel) publishPanel.hidden = true
  const publishLog = document.getElementById('publishLog')
  if (publishLog) {
    publishLog.innerHTML = '<span class="log-info">[publish] Submit a sanitized tool to begin…</span>'
  }
  const publishProg = document.getElementById('publishProgress')
  if (publishProg) publishProg.style.width = '0%'
}

/* ════════════════════════════════════════════════
   FILE INPUTS — two separate inputs
════════════════════════════════════════════════ */
const uploadZone = document.getElementById('uploadZone')
const fileInputFolder = document.getElementById('fileInputFolder')
const fileInputFile = document.getElementById('fileInputFile')
const uploadProg = document.getElementById('uploadProgress')
const uploadStat = document.getElementById('uploadStatus')

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  uploadZone.classList.add('drag-over')
})
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'))
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault()
  uploadZone.classList.remove('drag-over')
  handleFiles(Array.from(e.dataTransfer.files))
})
fileInputFolder.addEventListener('change', (e) => {
  handleFiles(Array.from(e.target.files))
  e.target.value = ''
})
fileInputFile.addEventListener('change', (e) => {
  handleFiles(Array.from(e.target.files))
  e.target.value = ''
})

/* ════════════════════════════════════════════════
   ASSET MAP HELPERS
════════════════════════════════════════════════ */
const MIME_MAP = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  css: 'text/css',
  js: 'application/javascript',
  txt: 'text/plain',
  json: 'application/json',
}

function fileIcon(ext) {
  return (
    {
      html: '🌐',
      htm: '🌐',
      css: '🎨',
      js: '⚙️',
      png: '🖼️',
      jpg: '🖼️',
      jpeg: '🖼️',
      gif: '🖼️',
      svg: '🖼️',
      webp: '🖼️',
      pdf: '📄',
      txt: '📝',
      json: '📋',
    }[ext] || '📎'
  )
}

function readAsText(file) {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = (e) => res(e.target.result)
    r.readAsText(file)
  })
}

function readAsDataURL(file) {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = (e) => res(e.target.result)
    r.readAsDataURL(file)
  })
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function normalizeUploadPath(file) {
  return String(file.webkitRelativePath || file.name)
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
}

/**
 * Strip a shared top-level folder from folder uploads so files land at the tool root.
 * e.g. "My Tool/index.html" → "index.html"
 */
function normalizeBundlePaths(entries) {
  if (!entries.length) return entries

  const splitPaths = entries.map((e) =>
    String(e.path).replace(/\\/g, '/').split('/').filter(Boolean)
  )
  if (!splitPaths.every((segs) => segs.length > 1)) return entries

  let commonDepth = 0
  while (true) {
    const segment = splitPaths[0][commonDepth]
    if (segment === undefined) break
    if (!splitPaths.every((segs) => segs[commonDepth] === segment)) break
    commonDepth++
  }
  if (commonDepth === 0) return entries

  return entries.map((e) => ({
    ...e,
    path: String(e.path)
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .slice(commonDepth)
      .join('/'),
  }))
}

const TEXT_EXTS = new Set(['html', 'htm', 'css', 'js', 'txt', 'json', 'svg'])

const JS_UNSAFE_REPLACEMENTS = [
  { re: /\beval\s*\(/g, replacement: 'void 0 /* eval stripped */(', reason: 'eval() removed' },
  {
    re: /\bnew\s+Function\s*\(/g,
    replacement: 'void 0 /* Function stripped */(',
    reason: 'Function() constructor removed',
  },
  {
    re: /setTimeout\s*\(\s*(['"`])/g,
    replacement: 'void 0 /* setTimeout(string) stripped */($1',
    reason: 'setTimeout(string) removed',
  },
  {
    re: /setInterval\s*\(\s*(['"`])/g,
    replacement: 'void 0 /* setInterval(string) stripped */($1',
    reason: 'setInterval(string) removed',
  },
  {
    re: /document\.write\s*\(/g,
    replacement: 'void 0 /* document.write stripped */(',
    reason: 'document.write() removed',
  },
]

/**
 * Sanitize a JavaScript source file or inline script block.
 * @returns {{ code: string, strips: number, log: string[], report: object[] }}
 */
function sanitizeJS(code, filename = 'script.js') {
  const report = []
  let strips = 0
  let out = code

  JS_UNSAFE_REPLACEMENTS.forEach(({ re, replacement, reason }) => {
    re.lastIndex = 0
    if (re.test(out)) {
      re.lastIndex = 0
      out = out.replace(re, replacement)
      strips++
      report.push({
        element: filename,
        action: 'stripped',
        reason,
        location: filename,
      })
    }
  })

  const log =
    strips === 0
      ? [`<span class="log-ok">[sanitizer] ✅ ${escapeHTML(filename)} — no unsafe patterns.</span>`]
      : [
          `<span class="log-err">[sanitizer] ⚠️ ${escapeHTML(filename)} — ${strips} pattern(s) neutralized.</span>`,
          ...report.map(
            (r) =>
              `<span class="log-warn">[STRIPPED] ${escapeHTML(r.reason)}</span>`
          ),
        ]

  return { code: out, strips, log, report }
}

function deriveBundleName(files, htmlFiles) {
  const first = htmlFiles[0]
  const path = normalizeUploadPath(first)
  const parts = path.split('/').filter(Boolean)
  if (parts.length > 1) return parts[0]
  return parts[0].replace(/\.(html|htm)$/i, '') || 'tool'
}

function aggregateSanitMeta(sanitMeta) {
  const totalStrips = sanitMeta.reduce((s, m) => s + (m.strips || 0), 0)
  const report = sanitMeta.flatMap((m) =>
    (m.report || []).map((r) => ({ ...r, element: r.element || m.path }))
  )
  const log = sanitMeta.flatMap((m) => m.log || [])
  return { strips: totalStrips, report, log }
}

/**
 * Build the full sanitized upload bundle — HTML and JS sanitized; paths preserved.
 */
async function buildSanitizedBundle(files) {
  const entries = []
  const sanitMeta = []

  for (const f of files) {
    const path = normalizeUploadPath(f)
    const ext = path.split('.').pop().toLowerCase()

    if (/\.(html|htm)$/i.test(path)) {
      const raw = await readAsText(f)
      const sanit = sanitizeHTML(raw)
      entries.push({ path, content: sanit.html })
      sanitMeta.push({ path, ...sanit })
    } else if (ext === 'js') {
      const raw = await readAsText(f)
      const sanit = sanitizeJS(raw, path)
      entries.push({ path, content: sanit.code })
      sanitMeta.push({ path, strips: sanit.strips, report: sanit.report, log: sanit.log })
    } else if (TEXT_EXTS.has(ext)) {
      entries.push({ path, content: await readAsText(f) })
    } else {
      const dataUrl = await readAsDataURL(f)
      entries.push({ path, content: dataUrl.split(',')[1], encoding: 'base64' })
    }
  }

  const normalized = normalizeBundlePaths(entries)
  const pathMap = new Map(entries.map((e, i) => [e.path, normalized[i]?.path || e.path]))
  const normalizedMeta = sanitMeta.map((m) => ({
    ...m,
    path: pathMap.get(m.path) || m.path,
  }))

  return { entries: normalized, sanitMeta: normalizedMeta }
}

async function buildAssetMap(assetFiles) {
  const map = {}
  await Promise.all(
    assetFiles.map(async (f) => {
      const ext = f.name.split('.').pop().toLowerCase()
      const mime = MIME_MAP[ext] || 'application/octet-stream'
      const isText = ['css', 'js', 'txt', 'json', 'svg'].includes(ext)
      let dataUrl
      if (isText) {
        const text = await readAsText(f)
        dataUrl = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`
      } else {
        dataUrl = await readAsDataURL(f)
      }
      // Store by full path AND basename so both relative forms resolve
      map[f.name] = dataUrl
      map[f.name.split('/').pop()] = dataUrl
    })
  )
  return map
}

function inlineAssets(html, assetMap) {
  return html.replace(/(src|href)=["']([^"'#?:][^"']*?)["']/gi, (match, attr, path) => {
    const basename = path.split('/').pop()
    if (assetMap[path]) return `${attr}="${assetMap[path]}"`
    if (assetMap[basename]) return `${attr}="${assetMap[basename]}"`
    return match
  })
}

/* ════════════════════════════════════════════════
   MAIN FILE HANDLER
════════════════════════════════════════════════ */
async function handleFiles(files) {
  if (!ROLES[currentRole].canUpload) {
    toast('🚫 No upload permission.')
    return
  }
  if (files.length === 0) return

  const htmlFiles = files.filter((f) => /\.(html|htm)$/i.test(f.name))
  const assetFiles = files.filter((f) => !/\.(html|htm)$/i.test(f.name))

  if (htmlFiles.length === 0) {
    toast('❌ No .html / .htm file found in selection.')
    return
  }

  const totalSize = files.reduce((s, f) => s + f.size, 0)
  if (totalSize > 10 * 1024 * 1024) {
    toast('❌ Total bundle exceeds 10 MB.')
    return
  }

  renderFileListPreview(files, totalSize)
  uploadProg.style.width = '10%'
  uploadStat.textContent = `Processing ${files.length} file(s) (${formatFileSize(totalSize)})…`

  const { entries: bundleFiles, sanitMeta } = await buildSanitizedBundle(files)
  const bundleName = deriveBundleName(files, htmlFiles)
  const bundleSanit = aggregateSanitMeta(sanitMeta)
  uploadProg.style.width = '25%'

  // Build shared asset map for inlined preview
  const assetMap = await buildAssetMap(assetFiles)
  uploadProg.style.width = '35%'

  // Process every HTML file
  const results = [] // { file, inlined, sanitResult, analysisResult }
  for (let i = 0; i < htmlFiles.length; i++) {
    const f = htmlFiles[i]
    const raw = await readAsText(f)
    const inlined = inlineAssets(raw, assetMap)
    const sanit = sanitizeHTML(inlined)
    const analysis = analyzeHTML(sanit.html, f.name)
    results.push({ file: f, inlined, sanitResult: sanit, analysisResult: analysis })
    uploadProg.style.width = 35 + ((i + 1) / htmlFiles.length) * 55 + '%'
  }

  uploadProg.style.width = '100%'
  const jsCount = files.filter((f) => /\.js$/i.test(f.name)).length
  uploadStat.textContent = `✅ ${files.length} file(s) (${formatFileSize(totalSize)}) — ${htmlFiles.length} HTML + ${jsCount} JS sanitized.`

  // Show sanitize results (tabbed if >1 HTML, includes bundle JS summary)
  renderAllSanitizeResults(results, bundleSanit, sanitMeta)

  // Show analysis + preview for first (or only) file
  showAnalysis(results[0].analysisResult)
  showSandbox(results[0].sanitResult.html)

  const mode = getUploadMode()

  if (mode === 'sanitize') {
    sanitizeOnlyResults = [
      {
        name: bundleName,
        zipName: `${bundleName}_sanitized.zip`,
        bundleFiles,
        content: results[0].sanitResult.html,
        sanitResult: bundleSanit,
        htmlResults: results,
      },
    ]
    renderSanitizeDlSection()
    toast(`🛡️ Bundle sanitized (${bundleFiles.length} files). Download ZIP or submit to GitHub.`)
    advanceStep(2)
    advanceStep(3)
    // Make sure queue download section is hidden
    document.getElementById('sanitDlSection').style.display = ''
  } else {
    resetSanitizeDlSection()
    uploadedTools.push({
      id: 'tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name: bundleName,
      content: results[0].sanitResult.html,
      bundleFiles,
      zipName: `${bundleName}_sanitized.zip`,
      risk: results[0].analysisResult.risk,
      status: 'pending',
      uploadedBy: ROLES[currentRole].label,
      analysisResult: results[0].analysisResult,
    })
    advanceStep(2)
    advanceStep(3)
    refreshQueue()
    refreshToolSelect()
    toast(`📤 "${bundleName}" bundle (${bundleFiles.length} files) added to approval queue.`)
  }
}

/* ════════════════════════════════════════════════
   SANITIZER
   Returns { html, strips, log, report[] }
════════════════════════════════════════════════ */
const SANITIZER_CONFIG = {
  FORBIDDEN_TAGS: ['object', 'embed', 'applet', 'base', 'frame', 'frameset', 'iframe'],
  FORBIDDEN_ATTR_PREFIX: 'on', // all on* attrs
  EXTRA_FORBIDDEN_ATTRS: ['srcdoc'],
  UNSAFE_URL_ATTRS: new Set(['src', 'href', 'action', 'formaction', 'data']),
  UNSAFE_URL_RE: /^(javascript:|vbscript:|data:text\/html)/i,
}

function sanitizeHTML(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const report = []
  let strips = 0

  // 1. Remove forbidden tags
  SANITIZER_CONFIG.FORBIDDEN_TAGS.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((el) => {
      report.push({
        element: `<${tag}>`,
        action: 'stripped',
        reason: 'Forbidden tag',
        location: describeEl(el),
      })
      el.remove()
      strips++
    })
  })

  // 2. Attribute pass over every remaining element
  doc.querySelectorAll('*').forEach((el) => {
    const attrsToRemove = []
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const val = attr.value

      // on* handlers
      if (name.startsWith(SANITIZER_CONFIG.FORBIDDEN_ATTR_PREFIX)) {
        attrsToRemove.push({ name, reason: 'Inline event handler' })
        return
      }
      // Extra forbidden attrs
      if (SANITIZER_CONFIG.EXTRA_FORBIDDEN_ATTRS.includes(name)) {
        attrsToRemove.push({ name, reason: 'Forbidden attribute' })
        return
      }
      // Unsafe URL scheme
      if (SANITIZER_CONFIG.UNSAFE_URL_ATTRS.has(name) && SANITIZER_CONFIG.UNSAFE_URL_RE.test(val)) {
        attrsToRemove.push({ name, reason: `Unsafe URL scheme (${val.substring(0, 40)})` })
      }
    })

    attrsToRemove.forEach(({ name, reason }) => {
      report.push({
        element: `<${el.tagName.toLowerCase()}> @${name}`,
        action: 'stripped',
        reason,
        location: describeEl(el),
      })
      el.removeAttribute(name)
      strips++
    })
  })

  // 3. Sanitize inline <script> blocks (no src)
  doc.querySelectorAll('script:not([src])').forEach((el) => {
    const src = el.textContent
    if (!src || !src.trim()) return
    const sanit = sanitizeJS(src, 'inline <script>')
    if (sanit.strips > 0) {
      el.textContent = sanit.code
      strips += sanit.strips
      report.push(...sanit.report)
    }
  })

  // 4. Rebuild with CSP
  const headHTML = doc.head ? doc.head.innerHTML : ''
  const bodyHTML = doc.body ? doc.body.innerHTML : ''
  const out = `<!DOCTYPE html><html><head>\n<meta charset="UTF-8">\n${headHTML}\n<meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' data: blob:; connect-src 'none';">\n</head><body>${bodyHTML}</body></html>`

  const log =
    strips === 0
      ? ['<span class="log-ok">[sanitizer] ✅ No dangerous elements found.</span>']
      : [
          `<span class="log-err">[sanitizer] ⚠️ ${strips} item(s) removed.</span>`,
          ...report.map(
            (r) =>
              `<span class="log-warn">[STRIPPED] ${escapeHTML(r.element)} — ${escapeHTML(r.reason)}</span>`
          ),
        ]

  return { html: out, strips, log, report }
}

function describeEl(el) {
  const id = el.id ? `#${el.id}` : ''
  const cls =
    el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/)[0]
      : ''
  return `<${el.tagName.toLowerCase()}${id}${cls}>`
}

/* ════════════════════════════════════════════════
   RENDER SANITIZE RESULTS (single or tabbed)
════════════════════════════════════════════════ */
function renderAllSanitizeResults(results, bundleSanit, sanitMeta) {
  const tabStrip = document.getElementById('sanitTabStrip')
  const tabPanels = document.getElementById('sanitTabPanels')
  const singleWrap = document.getElementById('sanitSingleWrap')
  const summaryEl = document.getElementById('sanitizeSummary')
  const pillEl = document.getElementById('sanitizePill')

  const htmlStrips = results.reduce((s, r) => s + r.sanitResult.strips, 0)
  const jsStrips = (sanitMeta || [])
    .filter((m) => /\.js$/i.test(m.path))
    .reduce((s, m) => s + (m.strips || 0), 0)
  const totalStrips = bundleSanit?.strips ?? htmlStrips + jsStrips

  // Summary pill in card header
  if (pillEl) {
    pillEl.innerHTML =
      totalStrips > 0
        ? `<span class="sanitize-pill warn">⚠️ ${totalStrips} stripped</span>`
        : `<span class="sanitize-pill">✅ All clean</span>`
  }
  if (summaryEl) {
    const jsCount = (sanitMeta || []).filter((m) => /\.js$/i.test(m.path)).length
    const fileSummary =
      jsCount > 0
        ? `${results.length} HTML + ${jsCount} JS file(s)`
        : `${results.length} HTML file(s)`
    summaryEl.innerHTML =
      totalStrips > 0
        ? `<span class="sanitize-pill warn">⚠️ ${totalStrips} item(s) stripped across ${fileSummary}</span>`
        : `<span class="sanitize-pill">✅ ${fileSummary} clean</span>`
  }

  if (results.length === 1) {
    tabStrip.style.display = 'none'
    tabPanels.innerHTML = ''
    singleWrap.style.display = ''
    const mergedSanit = {
      ...results[0].sanitResult,
      strips: totalStrips,
      report: [
        ...results[0].sanitResult.report,
        ...(bundleSanit?.report || []).filter((r) => /\.js$/i.test(r.location || r.element || '')),
      ],
      log: [
        ...results[0].sanitResult.log,
        ...(sanitMeta || [])
          .filter((m) => /\.js$/i.test(m.path))
          .flatMap((m) => m.log || []),
      ],
    }
    renderSingleSanitizeResult(
      mergedSanit,
      results[0].file.name,
      'sanitizeLog',
      'sanitizeReport',
      'sanitReportBody',
      'sanitReportSummary'
    )
  } else {
    // Multi file: build tabs
    singleWrap.style.display = 'none'
    tabStrip.style.display = ''
    tabStrip.innerHTML = ''
    tabPanels.innerHTML = ''

    results.forEach((r, idx) => {
      const tabId = `sanit-tab-${idx}`
      const panelId = `sanit-panel-${idx}`
      const fname = r.file.name.split('/').pop()
      const badge = r.sanitResult.strips > 0 ? ' ⚠️' : ' ✅'

      // Tab button
      const tab = document.createElement('div')
      tab.className = 'file-tab' + (idx === 0 ? ' active' : '')
      tab.id = tabId
      tab.textContent = fname + badge
      tab.onclick = () => switchSanitTab(idx, results.length)
      tabStrip.appendChild(tab)

      // Panel
      const logId = `sanit-log-${idx}`
      const rptId = `sanit-rpt-${idx}`
      const rptBody = `sanit-rptbody-${idx}`
      const rptSumm = `sanit-rptsum-${idx}`
      const panel = document.createElement('div')
      panel.className = 'file-tab-panel' + (idx === 0 ? ' active' : '')
      panel.id = panelId
      panel.innerHTML = `
        <div id="${logId}" class="log-box" style="max-height:100px;"></div>
        <div id="${rptId}" class="sanit-report">
          <div class="sanit-report-header">
            <span>📋 Sanitization Report — ${escapeHTML(fname)}</span>
            <span id="${rptSumm}" style="color:var(--gray-5);font-weight:400;"></span>
          </div>
          <table class="sanit-table">
            <thead><tr><th>Element / Attribute</th><th>Action</th><th>Reason</th><th>Location</th></tr></thead>
            <tbody id="${rptBody}"></tbody>
          </table>
        </div>`
      tabPanels.appendChild(panel)

      renderSingleSanitizeResult(r.sanitResult, fname, logId, rptId, rptBody, rptSumm)
    })
  }
}

function switchSanitTab(activeIdx, total) {
  for (let i = 0; i < total; i++) {
    document.getElementById(`sanit-tab-${i}`)?.classList.toggle('active', i === activeIdx)
    document.getElementById(`sanit-panel-${i}`)?.classList.toggle('active', i === activeIdx)
  }
}

function renderSingleSanitizeResult(sanitResult, filename, logId, reportId, bodyId, summId) {
  const logEl = document.getElementById(logId)
  const rptEl = document.getElementById(reportId)
  const bodyEl = document.getElementById(bodyId)
  const summEl = document.getElementById(summId)

  if (logEl) logEl.innerHTML = sanitResult.log.join('<br>')
  if (!rptEl || !bodyEl) return

  // Always show report expanded
  rptEl.style.display = 'block'

  if (summEl) {
    summEl.textContent =
      sanitResult.strips > 0 ? `${sanitResult.strips} item(s) removed` : '0 items changed'
  }

  if (sanitResult.report.length === 0) {
    bodyEl.innerHTML = `<tr><td colspan="4" class="sanit-report-empty">✅ Nothing stripped — file passed all checks.</td></tr>`
    return
  }

  bodyEl.innerHTML = sanitResult.report
    .map((r) => {
      const cls = r.action === 'stripped' ? 'stripped' : 'clean'
      const icon = r.action === 'stripped' ? '🗑️ Stripped' : '✅ Kept'
      return `<tr class="${cls}">
      <td><code>${escapeHTML(r.element)}</code></td>
      <td>${icon}</td>
      <td>${escapeHTML(r.reason)}</td>
      <td><code style="font-size:.7rem;color:var(--gray-5);">${escapeHTML(r.location)}</code></td>
    </tr>`
    })
    .join('')
}

/* ════════════════════════════════════════════════
   SANITIZE-ONLY DOWNLOAD SECTION
════════════════════════════════════════════════ */
function renderSanitizeDlSection() {
  const sec = document.getElementById('sanitDlSection')
  const list = document.getElementById('sanitDlList')
  if (!sec || !list) return

  list.innerHTML = sanitizeOnlyResults
    .map((item, idx) => {
      const stripped = item.sanitResult?.strips ?? 0
      const fileCount = item.bundleFiles?.length ?? 0
      const badge =
        stripped > 0
          ? `<span class="badge badge-orange">⚠️ ${stripped} stripped</span>`
          : `<span class="badge badge-green">✅ Clean</span>`
      return `<div class="sanit-dl-item">
      <span style="font-size:1.2rem;">📦</span>
      <span class="sdl-name">${escapeHTML(item.zipName)}</span>
      <span class="badge badge-gray">${fileCount} file(s)</span>
      ${badge}
      <button class="btn btn-green btn-sm" onclick="downloadSanitizedZip(${idx})">⬇️ Download ZIP</button>
      <button class="btn btn-red btn-sm" onclick="promptPublishCategory(${idx})">🚀 Submit PR</button>
    </div>`
    })
    .join('')

  sec.style.display = ''
  const publishPanel = document.getElementById('publishPanel')
  if (publishPanel) publishPanel.hidden = false
}

const INTERNAL_USER_PORTAL_ID = 'internalUser'

function getInternalUserId() {
  const email = authSession?.email
  if (email) {
    const slug = email
      .split('@')[0]
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .toLowerCase()
    if (slug === 'internaluser') return INTERNAL_USER_PORTAL_ID
    return slug
  }
  return INTERNAL_USER_PORTAL_ID
}

function titleFromToolSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function promptPublishCategory(idx) {
  const item = sanitizeOnlyResults[idx]
  if (!item) return

  const dialog = document.getElementById('publishCategoryDialog')
  const toolNameEl = document.getElementById('publishCategoryToolName')
  const titleInput = document.getElementById('publishCategoryDisplayTitle')
  const mallRadio = document.getElementById('publishCategoryMall')
  const auctionRadio = document.getElementById('publishCategoryAuction')

  if (!dialog || !toolNameEl || !titleInput || !mallRadio || !auctionRadio) {
    submitForPublish(idx, 'mall')
    return
  }

  const toolName = toolNameFromSanitizeItem(item)
  toolNameEl.textContent = toolName
  titleInput.value = titleFromToolSlug(toolName)
  mallRadio.checked = true
  auctionRadio.checked = false
  dialog.dataset.publishIdx = String(idx)
  dialog.hidden = false
}

function closePublishCategoryDialog() {
  const dialog = document.getElementById('publishCategoryDialog')
  if (dialog) dialog.hidden = true
}

function confirmPublishCategory() {
  const dialog = document.getElementById('publishCategoryDialog')
  if (!dialog) return

  const idx = Number(dialog.dataset.publishIdx)
  const categoryInput = document.querySelector('input[name="publishCategory"]:checked')
  const titleInput = document.getElementById('publishCategoryDisplayTitle')
  const category = categoryInput?.value

  if (!category || !['mall', 'auction'].includes(category)) {
    toast('Please choose MALL or AUCTION')
    return
  }

  const toolTitle = titleInput?.value?.trim() || ''
  closePublishCategoryDialog()
  submitForPublish(idx, category, toolTitle)
}

function toolNameFromSanitizeItem(item) {
  return String(item.name)
    .replace(/_sanitized\.zip$/i, '')
    .replace(/_sanitized\.html$/i, '')
    .replace(/\.(html|htm)$/i, '')
}

async function readJsonResponse(res) {
  const text = await res.text()
  try {
    return { data: JSON.parse(text), raw: text }
  } catch {
    const hint = text.includes('<!DOCTYPE') || text.includes('<html')
      ? 'Server returned HTML instead of JSON — restart `node server.js` and use http://localhost:3000 (not Live Server / file://).'
      : 'Invalid JSON response from server.'
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    throw new Error(`${hint} (${res.status}: ${snippet})`)
  }
}

async function submitForPublish(idx, category, toolTitle) {
  const item = sanitizeOnlyResults[idx]
  if (!item) return

  const publishLog = document.getElementById('publishLog')
  const prog = document.getElementById('publishProgress')
  const toolName = toolNameFromSanitizeItem(item)
  const internalUserId = getInternalUserId()
  const portalCategory = category || 'mall'

  if (publishLog) {
    const fileCount = item.bundleFiles?.length ?? 0
    publishLog.innerHTML = `<span class="log-info">[publish] Opening PR for "${escapeHTML(toolName)}" (${fileCount} file(s), ${escapeHTML(portalCategory.toUpperCase())})…</span>`
  }
  if (prog) prog.style.width = '15%'

  try {
    const res = await fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        internalUserId,
        toolName,
        category: portalCategory,
        toolTitle: toolTitle || undefined,
        files:
          item.bundleFiles && item.bundleFiles.length > 0
            ? item.bundleFiles
            : [{ path: 'index.html', content: item.content }],
      }),
    })
    const { data } = await readJsonResponse(res)
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

    if (publishLog) {
      publishLog.innerHTML += `<br><span class="log-info">[publish] jobId: ${escapeHTML(data.jobId)}</span>`
      if (data.warning) {
        publishLog.innerHTML += `<br><span class="log-warn">[publish] ⚠️ ${escapeHTML(data.warning)}</span>`
      }
      publishLog.innerHTML += `<br><span class="log-info">[publish] Publish workflow started — creating PR (not Pages deploy yet)…</span>`
      if (data.pagesUrl) {
        publishLog.innerHTML += `<br><span class="log-info">[publish] Live URL after merge: <a href="${data.pagesUrl}" target="_blank" rel="noopener">${escapeHTML(data.pagesUrl)}</a></span>`
      }
    }
    if (prog) prog.style.width = '40%'
    await pollPublishStatus(data.jobId, publishLog, prog)
  } catch (err) {
    if (publishLog) {
      publishLog.innerHTML += `<br><span class="log-err">[publish] ❌ ${escapeHTML(err.message)}</span>`
    }
    toast('❌ Publish failed')
  }
}

async function pollPublishStatus(jobId, publishLog, prog) {
  const maxAttempts = 120
  let attempts = 0

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        clearInterval(interval)
        if (publishLog) {
          publishLog.innerHTML += `<br><span class="log-err">[publish] ❌ Timeout waiting for merge</span>`
        }
        reject(new Error('timeout'))
        return
      }

      try {
        const res = await fetch(`/api/publish-status/${jobId}`)
        const { data } = await readJsonResponse(res)
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)

        if (data.status === 'pending') {
          if (publishLog && attempts <= 3) {
            publishLog.innerHTML += `<br><span class="log-warn">[publish] Publish workflow running — opening PR… (${attempts * 5}s)</span>`
          } else if (publishLog && attempts === 6) {
            publishLog.innerHTML += `<br><span class="log-info">[publish] Still waiting for PR link from publish workflow…</span>`
          }
          return
        }

        if (data.status === 'failed') {
          clearInterval(interval)
          if (publishLog) {
            publishLog.innerHTML += `<br><span class="log-err">[publish] ❌ ${escapeHTML(data.error || 'Workflow failed')}</span>`
            if (data.actionsUrl) {
              publishLog.innerHTML += `<br><span class="log-info">[publish] <a href="${data.actionsUrl}" target="_blank" rel="noopener">View workflow run</a></span>`
            }
          }
          reject(new Error(data.error || 'workflow failed'))
          return
        }

        if (data.status === 'pr_open') {
          if (prog) prog.style.width = Math.min(45 + attempts * 0.5, 80) + '%'
          if (data.prUrl && publishLog && !publishLog.dataset.prShown) {
            publishLog.dataset.prShown = '1'
            publishLog.innerHTML += `<br><span class="log-ok">[publish] ✅ PR opened: <a href="${data.prUrl}" target="_blank" rel="noopener">Review on GitHub</a></span>`
            if (data.actionsUrl) {
              publishLog.innerHTML += `<br><span class="log-info">[publish] <a href="${data.actionsUrl}" target="_blank" rel="noopener">View publish workflow</a> (not Pages deploy)</span>`
            }
          } else if (attempts % 6 === 0 && publishLog) {
            publishLog.innerHTML += `<br><span class="log-warn">[publish] Awaiting PR merge on GitHub… (${attempts * 5}s)</span>`
          }
          return
        }

        if (data.status === 'deploying') {
          if (prog) prog.style.width = Math.min(70 + attempts * 0.3, 90) + '%'
          if (publishLog && !publishLog.dataset.deployShown) {
            publishLog.dataset.deployShown = '1'
            publishLog.innerHTML += `<br><span class="log-ok">[publish] ✅ PR merged — GitHub Pages deploying…</span>`
            publishLog.innerHTML += `<br><span class="log-info">[publish] Check the &quot;Deploy GitHub Pages&quot; workflow on Actions tab.</span>`
          } else if (attempts % 6 === 0 && publishLog) {
            publishLog.innerHTML += `<br><span class="log-warn">[publish] Waiting for Pages deploy… (${attempts * 5}s)</span>`
          }
          return
        }

        if (data.status === 'merged') {
          clearInterval(interval)
          if (prog) prog.style.width = '100%'
          if (publishLog) {
            publishLog.innerHTML += `<br><span class="log-ok">[publish] ✅ Live on GitHub Pages!</span>`
            if (data.pagesUrl) {
              publishLog.innerHTML += `<br><span class="log-ok">[publish] <a href="${data.pagesUrl}" target="_blank" rel="noopener">Open live tool</a></span>`
            }
          }
          toast('🌐 Tool published!')
          resolve()
        }
      } catch (e) {
        console.error('publish poll error', e)
      }
    }, 5000)
  })
}

function downloadSanitizedZip(idx) {
  const item = sanitizeOnlyResults[idx]
  if (!item?.bundleFiles?.length) return
  const zipBytes = buildSimpleZip(bundleFilesToZipEntries(item.bundleFiles))
  const blob = new Blob([zipBytes], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = item.zipName || `${item.name}_sanitized.zip`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  toast(`⬇️ Downloading ${a.download}`)
}

function bundleFilesToZipEntries(bundleFiles) {
  return bundleFiles.map((f) => ({
    name: f.path.replace(/\\/g, '/'),
    data:
      f.encoding === 'base64'
        ? Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0))
        : new TextEncoder().encode(f.content),
  }))
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ════════════════════════════════════════════════
   FILE LIST PREVIEW
════════════════════════════════════════════════ */
function renderFileListPreview(files, totalSize) {
  const wrap = document.getElementById('fileListPreview')
  if (!wrap) return
  wrap.style.display = ''
  const total = totalSize ?? files.reduce((s, f) => s + f.size, 0)
  const rows = files
    .map((f) => {
      const ext = f.name.split('.').pop().toLowerCase()
      const name = f.name.split('/').pop()
      return `<div class="fle">
      <span>${fileIcon(ext)}</span>
      <span class="fle-name">${escapeHTML(name)}</span>
      <span class="fle-size">${formatFileSize(f.size)}</span>
    </div>`
    })
    .join('')
  wrap.innerHTML =
    rows +
    `<div class="fle fle-total">
      <span>📦</span>
      <span class="fle-name">Total</span>
      <span class="fle-size">${formatFileSize(total)} · ${files.length} file(s)</span>
    </div>`
}

/* ════════════════════════════════════════════════
   STATIC ANALYSIS ENGINE
════════════════════════════════════════════════ */
function analyzeHTML(html, filename) {
  const log = [],
    checks = {}

  const sizeKB = (new Blob([html]).size / 1024).toFixed(1)
  checks.size = { pass: true, val: `${sizeKB} KB` }
  log.push(`<span class="log-ok">[PASS] File size: ${sizeKB} KB</span>`)

  const hasDOCTYPE = /<!DOCTYPE\s+html/i.test(html)
  checks.mime = { pass: hasDOCTYPE, val: hasDOCTYPE ? 'text/html ✓' : 'Suspect — no DOCTYPE' }
  log.push(
    hasDOCTYPE
      ? `<span class="log-ok">[PASS] DOCTYPE present</span>`
      : `<span class="log-warn">[WARN] No DOCTYPE detected</span>`
  )

  const extScripts = [...html.matchAll(/<script[^>]+src=["']https?:\/\/([^"']+)["']/gi)]
  checks.ext = {
    pass: extScripts.length === 0,
    val: extScripts.length === 0 ? 'None ✓' : `${extScripts.length} found`,
  }
  extScripts.forEach((m) =>
    log.push(`<span class="log-warn">[WARN] External script: ${m[1].substring(0, 60)}</span>`)
  )
  if (extScripts.length === 0) log.push(`<span class="log-ok">[PASS] No external scripts</span>`)

  const unsafePatterns = [
    'eval(',
    'Function(',
    'setTimeout("',
    "setTimeout('",
    'setInterval("',
    "setInterval('",
    'document.write(',
  ]
  const foundUnsafe = unsafePatterns.filter((p) => html.includes(p))
  checks.eval = {
    pass: foundUnsafe.length === 0,
    val: foundUnsafe.length === 0 ? 'Clean ✓' : foundUnsafe.join(', '),
  }
  foundUnsafe.forEach((p) => log.push(`<span class="log-err">[FLAG] Unsafe pattern: ${p}</span>`))
  if (foundUnsafe.length === 0)
    log.push(`<span class="log-ok">[PASS] No eval/unsafe patterns</span>`)

  const cookieAccess =
    html.includes('document.cookie') ||
    html.includes('localStorage') ||
    html.includes('sessionStorage')
  checks.cookie = { pass: !cookieAccess, val: cookieAccess ? 'Access detected' : 'No access ✓' }
  log.push(
    cookieAccess
      ? `<span class="log-warn">[WARN] Storage/cookie access detected</span>`
      : `<span class="log-ok">[PASS] No cookie/storage access</span>`
  )

  const frameEscape =
    html.includes('window.parent') || html.includes('window.top') || html.includes('window.opener')
  checks.escape = { pass: !frameEscape, val: frameEscape ? 'Escape attempt found' : 'Clean ✓' }
  log.push(
    frameEscape
      ? `<span class="log-err">[FLAG] Frame escape (window.parent/top)</span>`
      : `<span class="log-ok">[PASS] No frame escape</span>`
  )

  const flags = [!checks.eval.pass, !checks.escape.pass].filter(Boolean).length
  const warns = [!checks.ext.pass, !checks.cookie.pass].filter(Boolean).length
  const risk = flags > 0 ? 'high' : warns > 0 ? 'medium' : 'low'
  log.push(
    `<span class="${risk === 'high' ? 'log-err' : risk === 'medium' ? 'log-warn' : 'log-ok'}">[RESULT] Risk: ${risk.toUpperCase()}</span>`
  )

  return { checks, log, risk }
}

function showAnalysis(result) {
  const map = {
    size: 'chk-size',
    mime: 'chk-mime',
    ext: 'chk-ext',
    eval: 'chk-eval',
    cookie: 'chk-cookie',
    escape: 'chk-escape',
  }
  Object.entries(map).forEach(([key, elId]) => {
    const el = document.getElementById(elId)
    if (!el) return
    const c = result.checks[key]
    el.className =
      'check-item ' + (c.pass ? 'pass' : key === 'ext' || key === 'cookie' ? 'warn' : 'fail')
    el.querySelector('.ci-icon').textContent = c.pass
      ? '✅'
      : key === 'ext' || key === 'cookie'
        ? '⚠️'
        : '❌'
    el.querySelector('.ci-val').textContent = c.val
  })
  document.getElementById('analysisLog').innerHTML = result.log.join('<br>')
  document.getElementById('runAnalysisBtn').disabled = false
  advanceStep(2)
}

function runAnalysis() {
  const t = uploadedTools[uploadedTools.length - 1]
  if (!t) return
  showAnalysis(analyzeHTML(t.content, t.name))
  toast('🔄 Analysis re-run complete')
}

/* ════════════════════════════════════════════════
   SANDBOX PREVIEW
════════════════════════════════════════════════ */
function showSandbox(html) {
  if (currentBlobURL) URL.revokeObjectURL(currentBlobURL)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  currentBlobURL = URL.createObjectURL(blob)
  const frame = document.getElementById('sandboxFrame')
  frame.style.display = 'none'
  frame.src = currentBlobURL
  frame.onload = () => {
    frame.style.display = 'block'
    document.getElementById('sandboxPlaceholder').style.display = 'none'
  }
  advanceStep(3)
}

/* ════════════════════════════════════════════════
   APPROVAL QUEUE
════════════════════════════════════════════════ */
function refreshQueue() {
  const tbody = document.getElementById('queueBody')
  const r = ROLES[currentRole]
  let tools =
    currentRole === 'internalUser'
      ? uploadedTools.filter((t) => t.uploadedBy === r.label)
      : uploadedTools

  if (tools.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray-5);padding:24px;">
      ${currentRole === 'internalUser' ? 'You have not uploaded any tools yet.' : 'No tools uploaded yet'}
    </td></tr>`
    return
  }

  tbody.innerHTML = tools
    .map((t) => {
      const riskBadge =
        t.risk === 'high'
          ? '<span class="badge badge-red">High</span>'
          : t.risk === 'medium'
            ? '<span class="badge badge-orange">Medium</span>'
            : '<span class="badge badge-green">Low</span>'
      const statusBadge =
        t.status === 'approved'
          ? '<span class="badge badge-green">Approved</span>'
          : t.status === 'rejected'
            ? '<span class="badge badge-red">Rejected</span>'
            : '<span class="badge badge-orange">Pending</span>'
      let actionBtns
      if (r.canApprove && t.status === 'pending') {
        actionBtns = `<button class="btn btn-ghost btn-sm" onclick="openModal('${t.id}')">Review</button>`
      } else if (r.canApprove) {
        actionBtns = `<button class="btn btn-ghost btn-sm" onclick="previewTool('${t.id}')">Preview</button>`
      } else if (currentRole === 'internalUser') {
        actionBtns = `<button class="btn btn-ghost btn-sm" onclick="previewTool('${t.id}')">Preview</button>`
      } else {
        actionBtns = '—'
      }
      return `<tr>
      <td><strong>${escapeHTML(t.name)}</strong></td>
      <td>${escapeHTML(t.uploadedBy)}</td>
      <td>${riskBadge}</td>
      <td>${statusBadge}</td>
      <td>${actionBtns}</td>
    </tr>`
    })
    .join('')

  advanceStep(4)
}

function previewTool(id) {
  const t = uploadedTools.find((x) => x.id === id)
  if (t) {
    showSandbox(t.content)
    toast('👁️ Previewing: ' + t.name)
  }
}

/* ════════════════════════════════════════════════
   MODAL
════════════════════════════════════════════════ */
function openModal(id) {
  if (!ROLES[currentRole].canApprove) {
    toast('🚫 No review permission.')
    return
  }
  currentToolId = id
  const t = uploadedTools.find((x) => x.id === id)
  document.getElementById('modalMsg').textContent =
    `Tool: "${t.name}" | Risk: ${t.risk.toUpperCase()} | Uploaded by: ${t.uploadedBy}.`
  showSandbox(t.content)
  document.getElementById('approveModal').classList.add('open')
}

function closeModal() {
  document.getElementById('approveModal').classList.remove('open')
  currentToolId = null
}

function approveTool() {
  if (!ROLES[currentRole].canApprove) {
    closeModal()
    return
  }
  const t = uploadedTools.find((x) => x.id === currentToolId)
  if (t) {
    t.status = 'approved'
    toast(`✅ "${t.name}" approved`)
    refreshQueue()
    refreshToolSelect()
    advanceStep(4)
  }
  closeModal()
}

function rejectTool() {
  if (!ROLES[currentRole].canApprove) {
    closeModal()
    return
  }
  const t = uploadedTools.find((x) => x.id === currentToolId)
  if (t) {
    t.status = 'rejected'
    toast(`❌ "${t.name}" rejected`)
    refreshQueue()
  }
  closeModal()
}

/* ════════════════════════════════════════════════
   TOOL SELECT & PACKAGING
════════════════════════════════════════════════ */
function refreshToolSelect() {
  const sel = document.getElementById('toolSelect')
  const r = ROLES[currentRole]
  const tools = approvedTools()
  const buildBtn = document.getElementById('buildBtn')

  sel.innerHTML =
    tools.length === 0
      ? '<option value="">— No approved tools yet —</option>'
      : tools.map((t) => `<option value="${t.id}">${escapeHTML(t.name)}</option>`).join('')

  sel.disabled = !r.canDownload || tools.length === 0
  if (buildBtn) buildBtn.disabled = !r.canDownload || tools.length === 0
  renderUserToolList()
}

let lastDownloadUrl = ''
let lastWinDownloadUrl = ''

async function buildPackage() {
  if (!ROLES[currentRole].canDownload) {
    toast('🚫 No download permission.')
    return
  }
  const sel = document.getElementById('toolSelect')
  const tool = uploadedTools.find((t) => t.id === sel.value)
  if (!tool) {
    toast('Please select an approved tool.')
    return
  }

  const buildLog = document.getElementById('buildLog')
  const prog = document.getElementById('buildProgress')
  buildLog.innerHTML = `<span class="log-info">[packager] Triggering build: ${tool.name}</span>`
  prog.style.width = '10%'

  try {
    const res = await fetch('/api/package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: tool.name, htmlContent: tool.content }),
    })
    const { jobId } = await res.json()
    buildLog.innerHTML += `<br><span class="log-info">[packager] GitHub Actions building, jobId: ${jobId}</span>`
    prog.style.width = '30%'
    await pollBuildStatus(jobId, buildLog, prog)
  } catch (err) {
    buildLog.innerHTML += `<br><span class="log-err">[packager] ❌ Failed: ${err.message}</span>`
    toast('❌ Build failed')
  }
}

async function pollBuildStatus(jobId, buildLog, prog) {
  const maxAttempts = 60
  let attempts = 0
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        clearInterval(interval)
        buildLog.innerHTML += `<br><span class="log-err">[packager] ❌ Timeout</span>`
        reject(new Error('timeout'))
        return
      }
      try {
        const res = await fetch(`/api/build-status/${jobId}`)
        const data = await res.json()
        if (data.status === 'pending') {
          buildLog.innerHTML += `<br><span class="log-warn">[packager] Building… (${attempts * 5}s)</span>`
          prog.style.width = Math.min(30 + attempts * 1.5, 85) + '%'
          return
        }
        if (data.status === 'done') {
          clearInterval(interval)
          prog.style.width = '100%'
          buildLog.innerHTML += `<br><span class="log-ok">[packager] ✅ Build complete!</span>`
          buildLog.innerHTML += `<br><span class="log-info">[packager] <a href="${data.actionsUrl}" target="_blank">Download from GitHub Actions</a></span>`
          toast('📦 Build done!')
          advanceStep(5)
          advanceStep(6)
          resolve()
        }
      } catch (e) {
        console.error('error', e)
      }
    }, 5000)
  })
}

function downloadApp(platform) {
  if (!ROLES[currentRole].canDownload) {
    toast('🚫 No download permission.')
    return
  }
  if (platform === 'win' && lastWinDownloadUrl) {
    window.location.href = lastWinDownloadUrl
  } else if (platform === 'mac' && lastDownloadUrl) {
    window.location.href = lastDownloadUrl
  } else {
    toast('⚠️ No artifact yet — run Build first')
  }
}

/* ════════════════════════════════════════════════
   ZIP / CRC helpers
════════════════════════════════════════════════ */
function stringToUint8(str) {
  return new TextEncoder().encode(str)
}

function concatUint8(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function crc32(data) {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Build a store-only ZIP from [{ name, data: Uint8Array }]. */
function buildSimpleZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const nameBytes = stringToUint8(file.name)
    const data = file.data
    const crc = crc32(data)
    const size = data.length

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // local file header signature
    lv.setUint16(4, 20, true) // version needed to extract
    lv.setUint16(6, 0, true) // general purpose bit flag
    lv.setUint16(8, 0, true) // compression method: store
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // compressed size
    lv.setUint32(22, size, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // extra field length
    local.set(nameBytes, 30)
    localParts.push(local, data)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // central file header signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed to extract
    cv.setUint16(8, 0, true) // general purpose bit flag
    cv.setUint16(10, 0, true) // compression method: store
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true) // compressed size
    cv.setUint32(24, size, true) // uncompressed size
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // extra field length
    cv.setUint16(32, 0, true) // file comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal file attributes
    cv.setUint32(38, 0, true) // external file attributes
    cv.setUint32(42, offset, true) // relative offset of local header
    central.set(nameBytes, 46)
    centralParts.push(central)

    offset += local.length + data.length
  }

  const centralDir = concatUint8(centralParts)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true) // end of central dir signature
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralDir.length, true)
  ev.setUint32(16, offset, true)

  return concatUint8([...localParts, centralDir, end])
}

/* ════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════ */
function advanceStep(n) {
  if (isSlimUI()) return
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`step${i}`)
    if (!el) continue
    if (i < n) el.className = 'step done'
    else if (i === n) el.className = 'step active'
    else el.className = 'step'
  }
}

function toast(msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 2800)
}

function escapeHTML(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
}

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  uiFeatures = parseUiFeatures()
  await initAuth()
  currentRole = getLockedAppRole()
  configureTopNavChrome()
  const sel = document.getElementById('roleSelect')
  if (sel) sel.value = currentRole
  switchRole(currentRole, true)
  appReady = true
  if (isSlimUI()) {
    console.info(
      '[AI Tool Sandbox] Production UI. Engineers: ?dev=1 (full UI + nav chrome), ?dev=0 to turn off.'
    )
  }
})

window.addEventListener('popstate', refreshUiFromLocation)
window.addEventListener('pageshow', (ev) => {
  if (ev.persisted) refreshUiFromLocation()
})
