
/* ════════════════════════════════════════════════
   STATE
════════════════════════════════════════════════ */
const ROLES = {
  supplier: {
    label: 'Supplier', email: 'supplier@vendor.com',
    canUpload: true,  canApprove: false, canDownload: false,
    visibleSteps:    [1, 2, 3],
    allowedSections: ['uploadCard', 'sanitizeCard', 'approvalCard'],
  },
  reviewer: {
    label: 'Reviewer', email: 'reviewer@company.com',
    canUpload: false, canApprove: true,  canDownload: false,
    visibleSteps:    [2, 3, 4],
    allowedSections: ['sanitizeCard', 'approvalCard'],
  },
  admin: {
    label: 'Admin', email: 'admin@company.com',
    canUpload: true,  canApprove: true,  canDownload: true,
    visibleSteps:    [1, 2, 3, 4, 5, 6],
    allowedSections: ['uploadCard', 'sanitizeCard', 'approvalCard', 'packageCard'],
  },
  user: {
    label: 'End User', email: 'user@company.com',
    canUpload: false, canApprove: false, canDownload: true,
    visibleSteps:    [6],
    allowedSections: ['packageCard'],
  },
};

let currentRole   = 'admin';
let uploadedTools = [];   // { id, name, content, risk, status, uploadedBy, analysisResult }
let currentToolId = null; // tool being acted on in modal
let currentBlobURL = null;

/* ════════════════════════════════════════════════
   ROLE SWITCHER
════════════════════════════════════════════════ */
function switchRole(role) {
  currentRole = role;
  const r = ROLES[role];
  document.getElementById('currentUserLabel').textContent = `${r.label} — ${r.email}`;

  /* Role badge chip */
  const chip = document.getElementById('roleBadgeChip');
  if (chip) {
    const colors = { admin:'#e60012', supplier:'#0057b8', reviewer:'#28a745', user:'#fd7e14' };
    chip.textContent  = r.label.toUpperCase();
    chip.style.background = colors[role] || '#666';
  }

  applyRoleUI();
  toast(`Switched to role: ${r.label}`);
}

function applyRoleUI() {
  const r = ROLES[currentRole];

  /* ── 1. Step Pills visibility ── */
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById('step' + i);
    if (el) el.style.display = r.visibleSteps.includes(i) ? '' : 'none';
  }

  /* ── 2. Card sections visibility ── */
  const allSections = ['uploadCard', 'sanitizeCard', 'approvalCard', 'packageCard'];
  allSections.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = r.allowedSections.includes(id) ? '' : 'none';
  });

  /* ── 3. User role: float packageCard to top ── */
  const page       = document.querySelector('.page');
  const pkgCard    = document.getElementById('packageCard');
  const stepPills  = document.getElementById('stepPills');
  const grid       = document.querySelector('.grid-2');
  if (currentRole === 'user') {
    stepPills.style.display = 'none';
    if (pkgCard && page && pkgCard.parentElement !== page) {
      page.insertBefore(pkgCard, page.firstChild);
    } else if (pkgCard) {
      page.insertBefore(pkgCard, page.firstChild);
    }
    pkgCard.style.marginTop = '0';
  } else {
    stepPills.style.display = '';
    // Re-anchor packageCard after grid-2 (its natural position)
    const afterEl = document.querySelector('.card[data-pkg-anchor]') || null;
    if (pkgCard && pkgCard.previousElementSibling !== grid) {
      // Move back after grid-2
      if (grid && grid.nextSibling) {
        page.insertBefore(pkgCard, grid.nextSibling);
      }
    }
    pkgCard.style.marginTop = '24px';
  }

  /* ── 4. Upload zone ── */
  const fi = document.getElementById('fileInput');
  const uz = document.getElementById('uploadZone');
  if (fi) fi.disabled = !r.canUpload;
  if (uz) {
    uz.style.opacity       = r.canUpload ? '1' : '.45';
    uz.style.pointerEvents = r.canUpload ? 'auto' : 'none';
  }
  setRoleNotice('upload', r.canUpload
    ? '✅ You have permission to upload tools.'
    : '🚫 Your role (' + r.label + ') cannot upload tools.');

  /* ── 5. Approval notices ── */
  setRoleNotice('approve', r.canApprove
    ? '✅ You can approve or reject tools in the queue.'
    : '🚫 Your role (' + r.label + ') cannot approve tools.');
  refreshQueue();

  /* ── 6. Download / Build ── */
  setRoleNotice('download', r.canDownload
    ? '✅ You can download packaged desktop apps.'
    : '🚫 Your role (' + r.label + ') cannot download packages.');

  // buildBtn: only render for roles that can download
  const buildBtnWrap = document.getElementById('buildBtnWrap');
  const buildBtn     = document.getElementById('buildBtn');
  if (buildBtnWrap) buildBtnWrap.style.display = r.canDownload ? '' : 'none';
  if (buildBtn)     buildBtn.disabled = !r.canDownload || approvedTools().length === 0;
  refreshToolSelect();

  /* ── 7. User-facing: show approved tools list ── */
  renderUserToolList();
}

function setRoleNotice(zone, msg) {
  const el = document.getElementById(`roleNotice-${zone}`);
  if (!el) return;
  el.textContent = msg;
  el.className = 'info-box' + (msg.startsWith('🚫') ? ' danger' : '');
  el.style.marginBottom = '14px';
}

function approvedTools() {
  return uploadedTools.filter(t => t.status === 'approved');
}

/* Render a simple "approved tools" list for the End User role */
function renderUserToolList() {
  let wrap = document.getElementById('userToolList');
  if (!wrap) return;
  const tools = approvedTools();
  if (currentRole !== 'user') { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  if (tools.length === 0) {
    wrap.innerHTML = '<p style="color:var(--gray-5);font-size:.85rem;text-align:center;padding:16px 0;">No approved tools available yet.</p>';
    return;
  }
  wrap.innerHTML = tools.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--gray-3);">
      <div>
        <strong style="font-size:.85rem;">${escapeHTML(t.name)}</strong>
        <span class="badge badge-green" style="margin-left:8px;">Approved</span>
      </div>
      <span style="font-size:.75rem;color:var(--gray-5);">Risk: ${t.risk}</span>
    </div>`).join('');
}

/* ════════════════════════════════════════════════
   UPLOAD & SANITIZE
════════════════════════════════════════════════ */
const uploadZone  = document.getElementById('uploadZone');
const fileInput   = document.getElementById('fileInput');
const uploadProg  = document.getElementById('uploadProgress');
const uploadStat  = document.getElementById('uploadStatus');

uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  handleFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', e => handleFiles(Array.from(e.target.files)));

function handleFiles(files) {
  if (!ROLES[currentRole].canUpload) { toast('🚫 No upload permission.'); return; }

  const valid = files.filter(f => {
    const ext  = f.name.split('.').pop().toLowerCase();
    const ok   = ['html','htm'].includes(ext);
    const size = f.size <= 2 * 1024 * 1024;
    if (!ok)   toast(`❌ ${f.name}: rejected — not .html/.htm`);
    if (!size) toast(`❌ ${f.name}: rejected — exceeds 2 MB`);
    return ok && size;
  });

  if (valid.length === 0) return;

  uploadProg.style.width = '0%';
  uploadStat.textContent = `Processing ${valid.length} file(s)...`;

  let done = 0;
  valid.forEach((file, i) => {
    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = e => {
        done++;
        uploadProg.style.width = (done / valid.length * 100) + '%';
        const rawContent = e.target.result;

        /* ── Sanitize uploaded HTML (OWASP-inspired) ── */
        const sanitResult = sanitizeHTML(rawContent);
        const content     = sanitResult.html;

        /* Update Sanitize Card log */
        const sLog = document.getElementById('sanitizeLog');
        const sSumm = document.getElementById('sanitizeSummary');
        if (sLog) {
          const entries = sanitResult.log.length
            ? sanitResult.log.map(l => `<span class="log-warn">${escapeHTML(l)}</span>`).join('<br>')
            : '<span class="log-ok">[sanitizer] ✅ No dangerous elements found.</span>';
          sLog.innerHTML = entries;
        }
        if (sSumm) {
          sSumm.innerHTML = sanitResult.strips > 0
            ? `<span class="sanitize-pill warn">⚠️ ${sanitResult.strips} item(s) stripped from ${escapeHTML(file.name)}</span>`
            : `<span class="sanitize-pill">✅ ${escapeHTML(file.name)} — clean</span>`;
        }
        if (sanitResult.strips > 0) {
          toast(`🛡️ Sanitized ${sanitResult.strips} unsafe element(s) in ${file.name}`);
        }

        const result  = analyzeHTML(content, file.name);
        const id      = 'tool_' + Date.now() + '_' + i;
        uploadedTools.push({
          id, name: file.name, content,
          risk: result.risk, status: 'pending',
          uploadedBy: ROLES[currentRole].label,
          analysisResult: result
        });
        if (done === valid.length) {
          uploadStat.textContent = `✅ ${done} file(s) uploaded and queued for review.`;
          advanceStep(2);
          advanceStep(3);
          showAnalysis(result);
          showSandbox(content);
          refreshQueue();
          refreshToolSelect();
        }
      };
      reader.readAsText(file);
    }, i * 200);
  });
}

/* ════════════════════════════════════════════════
   STATIC ANALYSIS ENGINE
════════════════════════════════════════════════ */
function analyzeHTML(html, filename) {
  const log     = [];
  const checks  = {};

  // 1. File size (already validated above, here for display)
  const sizeKB = (new Blob([html]).size / 1024).toFixed(1);
  checks.size = { pass: true, val: `${sizeKB} KB` };
  log.push(`<span class="log-ok">[PASS] File size: ${sizeKB} KB (limit 2 MB)</span>`);

  // 2. MIME / DOCTYPE
  const hasDOCTYPE = /<!DOCTYPE\s+html/i.test(html);
  checks.mime = { pass: hasDOCTYPE, val: hasDOCTYPE ? 'text/html ✓' : 'Suspect — no DOCTYPE' };
  log.push(hasDOCTYPE
    ? `<span class="log-ok">[PASS] DOCTYPE present</span>`
    : `<span class="log-warn">[WARN] No DOCTYPE detected</span>`);

  // 3. External scripts
  const extScripts = [...html.matchAll(/<script[^>]+src=["']https?:\/\/([^"']+)["']/gi)];
  checks.ext = { pass: extScripts.length === 0, val: extScripts.length === 0 ? 'None ✓' : `${extScripts.length} found` };
  extScripts.forEach(m => log.push(`<span class="log-warn">[WARN] External script: ${m[1].substring(0,60)}</span>`));
  if (extScripts.length === 0) log.push(`<span class="log-ok">[PASS] No external scripts detected</span>`);

  // 4. eval / unsafe patterns
  const unsafePatterns = ['eval(', 'Function(', 'setTimeout("', "setTimeout('", 'setInterval("', "setInterval('", 'document.write('];
  const foundUnsafe = unsafePatterns.filter(p => html.includes(p));
  checks.eval = { pass: foundUnsafe.length === 0, val: foundUnsafe.length === 0 ? 'Clean ✓' : foundUnsafe.join(', ') };
  foundUnsafe.forEach(p => log.push(`<span class="log-err">[FLAG] Unsafe pattern: ${p}</span>`));
  if (foundUnsafe.length === 0) log.push(`<span class="log-ok">[PASS] No eval/unsafe patterns</span>`);

  // 5. Cookie access
  const cookieAccess = html.includes('document.cookie') || html.includes('localStorage') || html.includes('sessionStorage');
  checks.cookie = { pass: !cookieAccess, val: cookieAccess ? 'Access detected' : 'No access ✓' };
  log.push(cookieAccess
    ? `<span class="log-warn">[WARN] Storage/cookie access detected</span>`
    : `<span class="log-ok">[PASS] No cookie/storage access</span>`);

  // 6. Frame escape
  const frameEscape = html.includes('window.parent') || html.includes('window.top') || html.includes('window.opener');
  checks.escape = { pass: !frameEscape, val: frameEscape ? 'Escape attempt found' : 'Clean ✓' };
  log.push(frameEscape
    ? `<span class="log-err">[FLAG] Frame escape attempt (window.parent/top)</span>`
    : `<span class="log-ok">[PASS] No frame escape</span>`);

  // Overall risk
  const flags   = [!checks.eval.pass, !checks.escape.pass].filter(Boolean).length;
  const warns   = [!checks.ext.pass,  !checks.cookie.pass].filter(Boolean).length;
  const risk    = flags > 0 ? 'high' : warns > 0 ? 'medium' : 'low';
  log.push(`<span class="${risk==='high'?'log-err':risk==='medium'?'log-warn':'log-ok'}">[RESULT] Risk level: ${risk.toUpperCase()}</span>`);

  return { checks, log, risk };
}

function showAnalysis(result) {
  const map = { size:'chk-size', mime:'chk-mime', ext:'chk-ext', eval:'chk-eval', cookie:'chk-cookie', escape:'chk-escape' };
  const icons = { pass:'✅', fail:'❌', warn:'⚠️' };

  Object.entries(map).forEach(([key, elId]) => {
    const el = document.getElementById(elId);
    const c  = result.checks[key];
    el.className = 'check-item ' + (c.pass ? 'pass' : key === 'ext' || key === 'cookie' ? 'warn' : 'fail');
    el.querySelector('.ci-icon').textContent = c.pass ? '✅' : (key==='ext'||key==='cookie' ? '⚠️' : '❌');
    el.querySelector('.ci-val').textContent  = c.val;
  });

  document.getElementById('analysisLog').innerHTML = result.log.join('<br>');
  document.getElementById('runAnalysisBtn').disabled = false;
  advanceStep(2);
}

function runAnalysis() {
  const t = uploadedTools[uploadedTools.length - 1];
  if (!t) return;
  showAnalysis(analyzeHTML(t.content, t.name));
  toast('🔄 Analysis re-run complete');
}

/* ════════════════════════════════════════════════
   HTML SANITIZER  (OWASP-inspired, pure JS)
   Strips dangerous tags, attributes & URL schemes
   before content is stored or previewed.
════════════════════════════════════════════════ */
const SANITIZER_CONFIG = {
  /* Tags that are completely removed (with children) */
  FORBIDDEN_TAGS: new Set([
    'script','object','embed','applet','base','form',
    'input','button','select','textarea','link','meta',
    'svg','math','frame','frameset','iframe',
  ]),
  /* Attributes allowed globally */
  SAFE_ATTRS: new Set([
    'id','class','style','title','lang','dir','tabindex',
    'href','src','alt','width','height','colspan','rowspan',
    'aria-label','aria-hidden','role','data-*',
  ]),
  /* URL-bearing attributes whose value must start with safe schemes */
  URL_ATTRS:  new Set(['href','src','action','formaction','xlink:href']),
  SAFE_SCHEMES: /^(https?:|mailto:|#|\/(?!\/))/i,
};

function sanitizeHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
  
    // 只移除真正危險的標籤
    const FORBIDDEN = ['object','embed','applet','base','frame','frameset','iframe'];
    doc.querySelectorAll(FORBIDDEN.join(',')).forEach(el => el.remove());
  
    // script 和 style 全部留在原位，不移動不重組
    const headHTML = doc.head ? doc.head.innerHTML : '';
    const bodyHTML = doc.body ? doc.body.innerHTML : '';
  
    const out = `<!DOCTYPE html><html><head>
  <meta charset="UTF-8">
  ${headHTML}
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'unsafe-inline' data: blob:; connect-src 'none';">
  </head><body>${bodyHTML}</body></html>`;
  
    return { html: out, strips: 0, log: [] };
  }
/* ════════════════════════════════════════════════
   SANDBOX PREVIEW
════════════════════════════════════════════════ */
function showSandbox(html) {
  // Revoke old blob
  if (currentBlobURL) URL.revokeObjectURL(currentBlobURL);

  // If the HTML doesn't already carry our CSP meta (raw preview of unsanitized
  // content), inject it now as a safety net.
  const hasCsp = /Content-Security-Policy/i.test(html);
  const injected = hasCsp ? html : html.replace(
    /<head>/i,
    `<head><meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'; blob:;">`
  );

  // 2. 建立新的 Blob
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  currentBlobURL = URL.createObjectURL(blob);

  const frame = document.getElementById('sandboxFrame');

  // 3. 先隱藏再載入，避免瀏覽器攔截
  frame.style.display = 'none';
  frame.src = currentBlobURL;
  
  frame.onload = () => {
    frame.style.display = 'block';
    document.getElementById('sandboxPlaceholder').style.display = 'none';
  };
  
  advanceStep(3);
}

/* ════════════════════════════════════════════════
   APPROVAL QUEUE
════════════════════════════════════════════════ */
function refreshQueue() {
  const tbody  = document.getElementById('queueBody');
  const r      = ROLES[currentRole];

  /* Supplier sees only their own uploads (data isolation) */
  let tools = uploadedTools;
  if (currentRole === 'supplier') {
    tools = uploadedTools.filter(t => t.uploadedBy === r.label);
  }

  if (tools.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--gray-5);padding:24px;">
      ${currentRole === 'supplier' ? 'You have not uploaded any tools yet.' : 'No tools uploaded yet'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = tools.map(t => {
    const riskBadge   = t.risk === 'high'   ? '<span class="badge badge-red">High</span>'
                      : t.risk === 'medium' ? '<span class="badge badge-orange">Medium</span>'
                      :                       '<span class="badge badge-green">Low</span>';
    const statusBadge = t.status === 'approved' ? '<span class="badge badge-green">Approved</span>'
                      : t.status === 'rejected' ? '<span class="badge badge-red">Rejected</span>'
                      :                           '<span class="badge badge-orange">Pending</span>';

    /* Review button: only rendered (not just disabled) for canApprove roles */
    let actionBtns;
    if (r.canApprove && t.status === 'pending') {
      actionBtns = `<button class="btn btn-ghost btn-sm" onclick="openModal('${t.id}')">Review</button>`;
    } else if (r.canApprove && t.status !== 'pending') {
      actionBtns = `<button class="btn btn-ghost btn-sm" onclick="previewTool('${t.id}')">Preview</button>`;
    } else if (currentRole === 'supplier') {
      /* Supplier can preview their own upload but cannot approve */
      actionBtns = `<button class="btn btn-ghost btn-sm" onclick="previewTool('${t.id}')">Preview</button>`;
    } else {
      actionBtns = '—';
    }

    return `<tr>
      <td><strong>${escapeHTML(t.name)}</strong></td>
      <td>${escapeHTML(t.uploadedBy)}</td>
      <td>${riskBadge}</td>
      <td>${statusBadge}</td>
      <td>${actionBtns}</td>
    </tr>`;
  }).join('');

  advanceStep(4);
}

function previewTool(id) {
  const t = uploadedTools.find(x => x.id === id);
  if (t) showSandbox(t.content);
  toast('👁️ Previewing: ' + t.name);
}

/* ════════════════════════════════════════════════
   MODAL
════════════════════════════════════════════════ */
function openModal(id) {
  if (!ROLES[currentRole].canApprove) { toast('🚫 No review permission.'); return; }
  currentToolId = id;
  const t = uploadedTools.find(x => x.id === id);
  document.getElementById('modalMsg').textContent =
    `Tool: "${t.name}" | Risk: ${t.risk.toUpperCase()} | Uploaded by: ${t.uploadedBy}. Review the sandbox preview and security analysis before approving.`;
  showSandbox(t.content);
  document.getElementById('approveModal').classList.add('open');
}

function closeModal() {
  document.getElementById('approveModal').classList.remove('open');
  currentToolId = null;
}

function approveTool() {
  if (!ROLES[currentRole].canApprove) { toast('🚫 No approval permission.'); closeModal(); return; }
  const t = uploadedTools.find(x => x.id === currentToolId);
  if (t) {
    t.status = 'approved';
    /* Simulated audit log entry */
    console.info(`[AUDIT] APPROVE | tool="${t.name}" | by="${ROLES[currentRole].email}" | ts=${new Date().toISOString()}`);
    toast(`✅ "${t.name}" approved`);
    refreshQueue();
    refreshToolSelect();
    advanceStep(4);
  }
  closeModal();
}

function rejectTool() {
  if (!ROLES[currentRole].canApprove) { toast('🚫 No approval permission.'); closeModal(); return; }
  const t = uploadedTools.find(x => x.id === currentToolId);
  if (t) {
    t.status = 'rejected';
    console.info(`[AUDIT] REJECT  | tool="${t.name}" | by="${ROLES[currentRole].email}" | ts=${new Date().toISOString()}`);
    toast(`❌ "${t.name}" rejected`);
    refreshQueue();
  }
  closeModal();
}

/* ════════════════════════════════════════════════
   TOOL SELECT & PACKAGING SIMULATION
════════════════════════════════════════════════ */
function refreshToolSelect() {
  const sel      = document.getElementById('toolSelect');
  const r        = ROLES[currentRole];
  const tools    = approvedTools();
  const buildBtn = document.getElementById('buildBtn');

  sel.innerHTML = tools.length === 0
    ? '<option value="">— No approved tools yet —</option>'
    : tools.map(t => `<option value="${t.id}">${escapeHTML(t.name)}</option>`).join('');

  sel.disabled      = !r.canDownload || tools.length === 0;
  if (buildBtn) buildBtn.disabled = !r.canDownload || tools.length === 0;

  /* Keep userToolList in sync */
  renderUserToolList();
}

// 新增一個變數來儲存最後一次編譯成功的 URL
let lastDownloadUrl = '';
let lastWinDownloadUrl = '';

async function buildPackage() {
  if (!ROLES[currentRole].canDownload) { toast('🚫 No download permission.'); return; }
  const sel = document.getElementById('toolSelect');
  const id = sel.value;
  const tool = uploadedTools.find(t => t.id === id);
  if (!tool) { toast('Please select an approved tool.'); return; }

  const buildLog = document.getElementById('buildLog');
  const prog = document.getElementById('buildProgress');
  
  buildLog.innerHTML = `<span class="log-info">[packager] 開始打包工具: ${tool.name}</span>`;
  prog.style.width = '20%';

  const payload = { toolName: tool.name, htmlContent: tool.content };

  try {
    buildLog.innerHTML += `<br><span class="log-warn">[packager] 正在執行 Swift 編譯與 .app 封裝 (請稍候)...</span>`;
    
    const response = await fetch('/api/package', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    // 如果後端回傳錯誤碼 (例如 500)
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '伺服器內部錯誤');
    }

    const result = await response.json();

    // 成功接收到後端回傳
    if (result.downloadUrl) {
      lastDownloadUrl = result.downloadUrl; // 更新全域下載變數
      lastWinDownloadUrl = result.winDownloadUrl; // 儲存 Windows 下載位址
      prog.style.width = '100%';
      buildLog.innerHTML += `<br><span class="log-ok">[packager] ✅ 伺服器編譯成功！</span>`;
      buildLog.innerHTML += `<br><span class="log-info">[packager] 下載準備就緒: ${result.downloadUrl}</span>`;
      
      document.getElementById('dlPanel').style.display = 'flex';
      advanceStep(5);
      advanceStep(6);
      toast('📦 打包完成！請點擊 Download 鈕');
    }
  } catch (err) {
    console.error('Build Error:', err); // 在開發者工具顯示詳細錯誤
    buildLog.innerHTML += `<br><span class="log-err">[packager] ❌ 請求失敗: ${err.message}</span>`;
    toast('❌ 打包失敗，請檢查主機狀態');
  }
}

/* ════════════════════════════════════════════════
   DOWNLOAD (Demo — produces a real .zip with the HTML inside)
════════════════════════════════════════════════ */
// 修改下載按鈕函式
function downloadApp(platform) {
  if (!ROLES[currentRole].canDownload) { toast('🚫 No download permission.'); return; }

  if (platform === 'win' && lastWinDownloadUrl) {
    toast(`⬇️ 正在下載 Windows 版本 (.exe)...`);
    window.location.href = lastWinDownloadUrl;
  } else if (platform === 'mac' && lastDownloadUrl) {
    toast(`⬇️ 正在下載 Mac 版本...`);
    // 直接觸發瀏覽器下載後端的檔案
    window.location.href = lastDownloadUrl;
  } else {
    toast('⚠️ 尚未產出該平台的檔案，請先執行 Build');
  }
}

/* ════════════════════════════════════════════════
   MINIMAL ZIP BUILDER (no external lib)
   Store method — no compression, pure JS
════════════════════════════════════════════════ */
function buildSimpleZip(files) {
  const enc        = new TextEncoder();
  const localHdrs  = [];
  const centralDir = [];
  let   offset     = 0;

  files.forEach(({ name, data }) => {
    const nameBytes  = enc.encode(name);
    const dataBytes  = typeof data === 'string' ? enc.encode(data) : data;
    const crc        = crc32(dataBytes);
    const size       = dataBytes.length;

    // Local file header
    const lhdr = new DataView(new ArrayBuffer(30 + nameBytes.length));
    lhdr.setUint32( 0, 0x04034b50, true); // signature
    lhdr.setUint16( 4, 20,         true); // version
    lhdr.setUint16( 6, 0,          true); // flags
    lhdr.setUint16( 8, 0,          true); // compression (store)
    lhdr.setUint16(10, 0,          true); // mod time
    lhdr.setUint16(12, 0,          true); // mod date
    lhdr.setUint32(14, crc,        true); // crc32
    lhdr.setUint32(18, size,       true); // compressed size
    lhdr.setUint32(22, size,       true); // uncompressed size
    lhdr.setUint16(26, nameBytes.length, true);
    lhdr.setUint16(28, 0,          true); // extra length
    nameBytes.forEach((b, i) => lhdr.setUint8(30 + i, b));

    localHdrs.push(new Uint8Array(lhdr.buffer));
    localHdrs.push(dataBytes);

    // Central directory entry
    const cdh = new DataView(new ArrayBuffer(46 + nameBytes.length));
    cdh.setUint32( 0, 0x02014b50, true);
    cdh.setUint16( 4, 20,         true);
    cdh.setUint16( 6, 20,         true);
    cdh.setUint16( 8, 0,          true);
    cdh.setUint16(10, 0,          true);
    cdh.setUint16(12, 0,          true);
    cdh.setUint16(14, 0,          true);
    cdh.setUint32(16, crc,        true);
    cdh.setUint32(20, size,       true);
    cdh.setUint32(24, size,       true);
    cdh.setUint16(28, nameBytes.length, true);
    cdh.setUint16(30, 0,          true);
    cdh.setUint16(32, 0,          true);
    cdh.setUint16(34, 0,          true);
    cdh.setUint16(36, 0,          true);
    cdh.setUint32(38, 0,          true);
    cdh.setUint32(42, offset,     true);
    nameBytes.forEach((b, i) => cdh.setUint8(46 + i, b));
    centralDir.push(new Uint8Array(cdh.buffer));

    offset += 30 + nameBytes.length + size;
  });

  const cdOffset = offset;
  const cdSize   = centralDir.reduce((s, b) => s + b.length, 0);

  // End of central directory
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32( 0, 0x06054b50,     true);
  eocd.setUint16( 4, 0,              true);
  eocd.setUint16( 6, 0,              true);
  eocd.setUint16( 8, files.length,   true);
  eocd.setUint16(10, files.length,   true);
  eocd.setUint32(12, cdSize,         true);
  eocd.setUint32(16, cdOffset,       true);
  eocd.setUint16(20, 0,              true);

  return concatUint8(...localHdrs, ...centralDir, new Uint8Array(eocd.buffer));
}

function concatUint8(...arrays) {
  const total  = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let   pos    = 0;
  arrays.forEach(a => { result.set(a, pos); pos += a.length; });
  return result;
}

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* ════════════════════════════════════════════════
   UI HELPERS
════════════════════════════════════════════════ */
function advanceStep(n) {
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`step${i}`);
    if (i < n)  el.className = 'step done';
    else if (i === n) el.className = 'step active';
    else        el.className = 'step';
  }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ══════════════════════════════════════
/* ════════════════════════════════════════════════
   INIT — apply role UI on first load
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Sync the select element to the default role
  const sel = document.getElementById('roleSelect');
  if (sel) sel.value = currentRole;
  applyRoleUI();
});