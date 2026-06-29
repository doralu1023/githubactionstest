require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const app = express();

app.use(express.json({ limit: '10mb' }));

const buildJobs = new Map();
const publishJobs = new Map();
const publishBundles = new Map();

/** GitHub workflow_dispatch total inputs payload limit (chars). */
const GH_WORKFLOW_INPUT_LIMIT = 65535;
const PUBLISH_BUNDLE_TTL_MS = 2 * 60 * 60 * 1000;

const CALLBACK_SECRET = process.env.CALLBACK_SECRET;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const PUBLISH_PAT = process.env.PUBLISH_PAT;
const GH_REPO = process.env.GITHUB_REPO;
const SERVER_URL = process.env.SERVER_URL;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_REVIEWER_USER_ID = process.env.SLACK_REVIEWER_USER_ID;

const [GH_OWNER, GH_REPO_NAME] = (GH_REPO || '').split('/');
const GITHUB_PAGES_BASE =
  process.env.GITHUB_PAGES_BASE ||
  (GH_OWNER && GH_REPO_NAME
    ? `https://${GH_OWNER.toLowerCase()}.github.io/${GH_REPO_NAME}`
    : '');

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

function getPublishToken() {
  return PUBLISH_PAT || GH_TOKEN;
}

function ghHeadersFor(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function githubApiErrorMessage(err, step) {
  const ghMsg = err.response?.data?.message;
  const detail = ghMsg || err.message || 'Unknown GitHub API error';
  return step ? `${step}: ${detail}` : detail;
}

function isGitHubTokenAccessError(message) {
  return /Resource not accessible by (personal access token|integration)/i.test(message || '');
}

function formatPublishTokenHelp() {
  return (
    'GitHub token cannot write to this repo. Set PUBLISH_PAT in .env (preferred) or GITHUB_TOKEN with: ' +
    'fine-grained — Contents (Read/Write) + Pull requests (Read/Write) on this repo; ' +
    'classic — repo scope. Authorize SSO for org repos if prompted.'
  );
}

function compareUrlForBranch(branch, title) {
  const encodedTitle = encodeURIComponent(title);
  return `https://github.com/${GH_REPO}/compare/main...${branch}?expand=1&title=${encodedTitle}`;
}

function slugify(value) {
  return String(value)
    .replace(/\.(html|htm)$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'tool';
}

async function ghGet(url) {
  const res = await axios.get(url, { headers: ghHeaders });
  return res.data;
}

async function ghPost(url, body) {
  const res = await axios.post(url, body, { headers: ghHeaders });
  return res.data;
}

async function ghGetWith(url, token, step) {
  try {
    const res = await axios.get(url, { headers: ghHeadersFor(token) });
    return res.data;
  } catch (err) {
    throw new Error(githubApiErrorMessage(err, step));
  }
}

async function ghPostWith(url, body, token, step) {
  try {
    const res = await axios.post(url, body, { headers: ghHeadersFor(token) });
    return res.data;
  } catch (err) {
    throw new Error(githubApiErrorMessage(err, step));
  }
}

async function getRepoContentText(filePath, ref = 'main', token = getPublishToken()) {
  try {
    const data = await ghGetWith(
      `https://api.github.com/repos/${GH_REPO}/contents/${filePath}?ref=${ref}`,
      token,
      `Read ${filePath}`
    );
    if (Array.isArray(data)) return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (/404/.test(err.message)) return null;
    throw err;
  }
}

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function isPagesLive(url) {
  if (!url) return false;
  try {
    const res = await axios.head(url, {
      maxRedirects: 5,
      validateStatus: () => true,
      timeout: 10000,
    });
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

const INTERNAL_USER_PORTAL_ID = 'internalUser';

function internalUserPathSlug(id) {
  const slug = slugify(id);
  if (slug === 'internaluser' || id === INTERNAL_USER_PORTAL_ID) {
    return INTERNAL_USER_PORTAL_ID;
  }
  return slug;
}

function pagesUrlFor(_internalUserId, toolName) {
  const toolSlug = slugify(toolName);
  return `${GITHUB_PAGES_BASE}/toolbox/tools/${toolSlug}/`;
}

function purgeExpiredPublishBundles() {
  const now = Date.now();
  for (const [jobId, bundle] of publishBundles.entries()) {
    if (now - bundle.createdAt > PUBLISH_BUNDLE_TTL_MS) {
      publishBundles.delete(jobId);
    }
  }
}

/** Strip shared top-level folder prefix from folder uploads. */
function normalizeBundlePaths(files) {
  if (!files.length) return files;

  const splitPaths = files.map((f) =>
    String(f.path).replace(/\\/g, '/').split('/').filter(Boolean)
  );
  if (!splitPaths.every((segs) => segs.length > 1)) return files;

  let commonDepth = 0;
  while (true) {
    const segment = splitPaths[0][commonDepth];
    if (segment === undefined) break;
    if (!splitPaths.every((segs) => segs[commonDepth] === segment)) break;
    commonDepth++;
  }
  if (commonDepth === 0) return files;

  return files.map((f) => ({
    ...f,
    path: String(f.path)
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .slice(commonDepth)
      .join('/'),
  }));
}

async function buildRegistryContentAsync(toolSlug, category, toolTitle, token) {
  let registry;
  const remoteRegistry = await getRepoContentText('toolbox/registry.json', 'main', token);
  if (remoteRegistry) {
    registry = JSON.parse(remoteRegistry);
  } else {
    registry = { baseUrl: GITHUB_PAGES_BASE, tools: {} };
  }

  registry.baseUrl = GITHUB_PAGES_BASE || registry.baseUrl;
  registry.tools[toolSlug] = {
    title: toolTitle || registry.tools[toolSlug]?.title || titleFromSlug(toolSlug),
    category,
  };

  return JSON.stringify(registry, null, 2) + '\n';
}

async function createGitBlob(content, encoding, token) {
  const body =
    encoding === 'base64'
      ? { content, encoding: 'base64' }
      : { content, encoding: 'utf-8' };
  return ghPostWith(
    `https://api.github.com/repos/${GH_REPO}/git/blobs`,
    body,
    token,
    'Create file blob'
  );
}

/**
 * Create branch + PR via GitHub Git API (no workflow bundle fetch required).
 */
async function publishViaGitHubApi({
  internalUserId,
  toolName,
  category,
  toolTitle,
  files,
}) {
  const token = getPublishToken();
  if (!token || !GH_REPO) {
    throw new Error('Set PUBLISH_PAT (preferred) or GITHUB_TOKEN, and GITHUB_REPO in .env');
  }

  const userSlug = internalUserPathSlug(internalUserId);
  const toolSlug = slugify(toolName);
  const toolPrefix = `toolbox/tools/${toolSlug}`;
  const branch = `publish/${userSlug}-${toolSlug}-${Date.now()}`;

  await ghGetWith(
    `https://api.github.com/repos/${GH_REPO}`,
    token,
    'Verify repo access'
  );

  const registryContent = await buildRegistryContentAsync(
    toolSlug,
    category,
    toolTitle || titleFromSlug(toolSlug),
    token
  );

  const mainRef = await ghGetWith(
    `https://api.github.com/repos/${GH_REPO}/git/ref/heads/main`,
    token,
    'Read main branch'
  );
  const baseSha = mainRef.object.sha;
  const baseCommit = await ghGetWith(
    `https://api.github.com/repos/${GH_REPO}/git/commits/${baseSha}`,
    token,
    'Read base commit'
  );

  const tree = [];
  for (const file of files) {
    const blob = await createGitBlob(file.content, file.encoding, token);
    tree.push({
      path: `${toolPrefix}/${String(file.path).replace(/\\/g, '/')}`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }

  const registryBlob = await createGitBlob(registryContent, 'utf-8', token);
  tree.push({
    path: 'toolbox/registry.json',
    mode: '100644',
    type: 'blob',
    sha: registryBlob.sha,
  });

  const newTree = await ghPostWith(
    `https://api.github.com/repos/${GH_REPO}/git/trees`,
    { base_tree: baseCommit.tree.sha, tree },
    token,
    'Create commit tree'
  );

  const commit = await ghPostWith(
    `https://api.github.com/repos/${GH_REPO}/git/commits`,
    {
      message: `Publish tool: ${toolSlug} (${userSlug})`,
      tree: newTree.sha,
      parents: [baseSha],
    },
    token,
    'Create commit'
  );

  await ghPostWith(
    `https://api.github.com/repos/${GH_REPO}/git/refs`,
    { ref: `refs/heads/${branch}`, sha: commit.sha },
    token,
    'Push publish branch'
  );

  const prTitle = `Publish: ${toolSlug}`;
  let prUrl;
  let prNumber = 0;

  try {
    const pr = await ghPostWith(
      `https://api.github.com/repos/${GH_REPO}/pulls`,
      {
        title: prTitle,
        head: branch,
        base: 'main',
        body: `Automated publish from AI Tool Sandbox.

- **Internal user:** \`${userSlug}\`
- **Tool:** \`${toolSlug}\`
- **Category:** \`${category}\`
- **Path:** \`toolbox/tools/${toolSlug}/\`

Merge to deploy via GitHub Pages. Portal nav updates after the tool page is live.`,
      },
      token,
      'Open pull request'
    );
    prUrl = pr.html_url;
    prNumber = pr.number;
  } catch (prErr) {
    if (!isGitHubTokenAccessError(prErr.message)) {
      throw prErr;
    }
    console.warn('[PUBLISH] PR API blocked — returning compare URL:', prErr.message);
    prUrl = compareUrlForBranch(branch, prTitle);
  }

  return {
    prUrl,
    prNumber,
    pagesUrl: pagesUrlFor(internalUserId, toolName),
    internalUserSlug: userSlug,
    toolSlug,
    publishMode: PUBLISH_PAT ? 'github_api_pat' : 'github_api',
  };
}

function publicPublishStatus(job) {
  const payload = {
    status: job.status,
    prUrl: job.prUrl,
    actionsUrl: job.actionsUrl,
    error: job.error,
    message: job.message,
  };
  if (job.status === 'deploying' || job.status === 'merged') {
    payload.pagesUrl = job.pagesUrl;
  }
  return payload;
}

/**
 * Ask engineers in Slack to review and merge a publish PR.
 * No-op when SLACK_WEBHOOK_URL is unset.
 *
 * @param {{ prUrl: string, prNumber?: number, toolName: string, internalUserId: string, category: string }} opts
 */
async function notifySlackPrReview({ prUrl, prNumber, toolName, internalUserId, category }) {
  if (!SLACK_WEBHOOK_URL || !prUrl) return;

  const mention = SLACK_REVIEWER_USER_ID ? `<@${SLACK_REVIEWER_USER_ID}> ` : '';
  const prLabel = prNumber ? `#${prNumber}` : 'open PR';
  const text = [
    `${mention}:github: *New publish PR — please review and merge*`,
    `• *Tool:* ${toolName}`,
    `• *Submitted by:* ${internalUserId}`,
    `• *Category:* ${category || 'mall'}`,
    `• *PR:* <${prUrl}|${prLabel}>`,
  ].join('\n');

  const res = await axios.post(
    SLACK_WEBHOOK_URL,
    { text },
    { timeout: 10000, responseType: 'text', validateStatus: () => true }
  );

  const body = String(res.data || '').trim();
  if (res.status !== 200 || body !== 'ok') {
    throw new Error(`Slack webhook failed (HTTP ${res.status}): ${body || 'empty response'}`);
  }
}

/**
 * Fire Slack notification without failing the publish flow.
 * @param {string} jobId
 * @param {{ prUrl: string, prNumber?: number, toolName: string, internalUserId: string, category: string }} opts
 */
function scheduleSlackPrReview(jobId, opts) {
  notifySlackPrReview(opts)
    .then(() => {
      const job = publishJobs.get(jobId);
      if (job) publishJobs.set(jobId, { ...job, slackNotified: true });
      console.log(`[SLACK] Notified for PR: ${opts.toolName} → ${opts.prUrl}`);
    })
    .catch((err) => {
      console.error('[SLACK] Notification failed:', err.message);
    });
}

/**
 * Trigger publish.yml — legacy fallback when GitHub API publish is unavailable.
 * @param {{ internalUserId: string, toolName: string, category: string, toolTitle?: string, files: Array<{path: string, content: string, encoding?: string}>, jobId: string }} opts
 */
async function triggerPublishWorkflow(
  { internalUserId, toolName, category, toolTitle, files, jobId }
) {
  const userSlug = internalUserPathSlug(internalUserId);
  const toolSlug = slugify(toolName);

  const inputs = {
    internal_user_id: userSlug,
    tool_name: toolSlug,
    category: category || 'mall',
    job_id: jobId,
    callback_url: `${SERVER_URL}/api/publish-complete`,
  };

  if (toolTitle) {
    inputs.tool_title = toolTitle;
  }

  if (!SERVER_URL) {
    throw new Error(
      'SERVER_URL must be set in .env so GitHub Actions can fetch the bundle (avoids 64KB workflow input limit).'
    );
  }
  inputs.bundle_url = `${SERVER_URL}/api/publish-bundle/${jobId}`;

  try {
    await axios.post(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/publish.yml/dispatches`,
      { ref: 'main', inputs },
      { headers: ghHeaders }
    );
  } catch (err) {
    const ghMsg = err.response?.data?.message || '';
    if (/Unexpected inputs provided/.test(ghMsg) && /bundle_url/.test(ghMsg)) {
      throw new Error(
        'publish.yml on GitHub main is out of date — push the latest .github/workflows/publish.yml (bundle_url input), then retry.'
      );
    }
    if (/inputs are too large/i.test(ghMsg)) {
      throw new Error(
        `Bundle exceeds GitHub workflow input limit (${GH_WORKFLOW_INPUT_LIMIT} chars total). Push the latest publish.yml (bundle_url fetch mode) to GitHub, then retry.`
      );
    }
    throw err;
  }

  return {
    pagesUrl: pagesUrlFor(internalUserId, toolName),
    internalUserSlug: userSlug,
    toolSlug,
    publishMode: 'bundle_url',
  };
}

/** Infer publish progress when the Actions callback never reaches this server. */
async function tryResolvePendingPublishJob(job) {
  const since = (job.dispatchedAt || 0) - 15000;
  if (!job.dispatchedAt || Date.now() - job.dispatchedAt < 8000) {
    return job;
  }

  try {
    const data = await ghGet(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/publish.yml/runs?event=workflow_dispatch&per_page=10`
    );
    const match = (data.workflow_runs || []).find(
      (r) => new Date(r.created_at).getTime() >= since
    );
    if (!match) return job;

    const actionsUrl = match.html_url;
    if (match.status !== 'completed') {
      return { ...job, status: 'pr_open', actionsUrl, prUrl: job.prUrl || actionsUrl };
    }
    if (match.conclusion === 'success') {
      return {
        ...job,
        status: 'pr_open',
        actionsUrl,
        prUrl: job.prUrl || actionsUrl,
        runId: match.id,
      };
    }
    return { ...job, status: 'failed', actionsUrl, error: `Workflow: ${match.conclusion}` };
  } catch (err) {
    console.error('[PUBLISH-POLL]', err.message);
    return job;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Okta session stub — replace with real OIDC middleware in production
app.get('/api/auth/me', (req, res) => {
  res.json({
    authenticated: false,
    provider: 'okta',
    email: '',
    name: 'Guest',
    canSwitchRoles: false,
    defaultAppRole: 'internalUser',
    primaryRole: 'internalUser',
  });
});

const fetchScript = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
};

async function bundleScripts(html) {
  const scriptRegex = /<script\s+src=["'](https?:\/\/[^"']+)["']><\/script>/gi;
  let match;
  let bundledHtml = html;
  while ((match = scriptRegex.exec(html)) !== null) {
    const url = match[1];
    try {
      console.log(`[BUNDLER] 下載: ${url}`);
      const content = await fetchScript(url);
      bundledHtml = bundledHtml.replace(match[0], `<script>${content}</script>`);
    } catch (e) {
      console.error(`[BUNDLER] 失敗: ${url}`, e);
    }
  }
  return bundledHtml;
}

// 觸發 GitHub Actions
app.post('/api/package', async (req, res) => {
  let { htmlContent, toolName } = req.body;
  htmlContent = await bundleScripts(htmlContent);

  const outputFileName = toolName
    .replace(/\.(html|htm)$/i, '')
    .replace(/\s+/g, '_');

  const htmlBase64 = Buffer.from(htmlContent).toString('base64');
  const jobId = `${outputFileName}-${Date.now()}`;

  buildJobs.set(jobId, { status: 'pending', toolName: outputFileName });

  try {
    await axios.post(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/build.yml/dispatches`,
      {
        ref: 'main',
        inputs: {
          html_base64: htmlBase64,
          tool_name: outputFileName,
          job_id: jobId,
          callback_url: `${SERVER_URL}/api/build-complete`
        }
      },
      {
        headers: {
          Authorization: `Bearer ${GH_TOKEN}`,
          Accept: 'application/vnd.github+json'
        }
      }
    );

    res.json({ jobId });

  } catch (err) {
    console.error(err.response?.data || err.message);
    buildJobs.delete(jobId);
    res.status(500).json({ error: '觸發 GitHub Actions 失敗' });
  }
});

// GitHub Actions callback
app.post('/api/build-complete', async (req, res) => {
  const secret = req.headers['x-callback-secret'];
  if (secret !== CALLBACK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { jobId, runId } = req.body;
  console.log(`[CALLBACK] jobId=${jobId} runId=${runId}`);

  try {
    const artifactsRes = await axios.get(
      `https://api.github.com/repos/${GH_REPO}/actions/runs/${runId}/artifacts`,
      { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } }
    );

    const artifacts = artifactsRes.data.artifacts;
    const toolName = buildJobs.get(jobId)?.toolName;

    const macArtifact = artifacts.find(a => a.name === `${toolName}-mac`);
    const winArtifact = artifacts.find(a => a.name === `${toolName}-windows`);

    buildJobs.set(jobId, {
      status: 'done',
      toolName,
      runId,
      macArtifactId: macArtifact?.id,
      winArtifactId: winArtifact?.id,
      actionsUrl: `https://github.com/${GH_REPO}/actions/runs/${runId}`
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Artifact 查詢失敗' });
  }
});

// GitHub Pages publish — workflow_dispatch publish.yml (Actions token has Contents write)
app.post('/api/publish', async (req, res) => {
  const { internalUserId, toolName, category, toolTitle, htmlContent, files } = req.body;

  if (!internalUserId || !toolName) {
    return res.status(400).json({ error: 'internalUserId and toolName are required' });
  }

  const portalCategory = String(category || '').toLowerCase();
  if (!['mall', 'auction'].includes(portalCategory)) {
    return res.status(400).json({ error: 'category must be "mall" or "auction"' });
  }

  const bundleFiles =
    Array.isArray(files) && files.length > 0
      ? files
      : htmlContent
        ? [{ path: 'index.html', content: htmlContent }]
        : null;

  if (!bundleFiles) {
    return res.status(400).json({ error: 'htmlContent or files[] is required' });
  }

  const publishFiles = normalizeBundlePaths(bundleFiles);

  const jobId = `publish-${slugify(toolName)}-${Date.now()}`;
  const pagesUrl = pagesUrlFor(internalUserId, toolName);

  publishJobs.set(jobId, {
    status: 'pending',
    toolName,
    internalUserId,
    category: portalCategory,
    pagesUrl,
    dispatchedAt: Date.now(),
  });

  try {
    const result = await publishViaGitHubApi({
      internalUserId,
      toolName,
      category: portalCategory,
      toolTitle,
      files: publishFiles,
    });

    publishJobs.set(jobId, {
      status: 'pr_open',
      toolName,
      internalUserId,
      category: portalCategory,
      pagesUrl: result.pagesUrl,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      dispatchedAt: Date.now(),
      publishMode: result.publishMode,
    });

    scheduleSlackPrReview(jobId, {
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      toolName,
      internalUserId,
      category: portalCategory,
    });

    res.json({
      jobId,
      prUrl: result.prUrl,
      publishMode: result.publishMode,
    });
  } catch (err) {
    console.error('[PUBLISH]', err.response?.data || err.message);
    const errMsg = err.response?.data?.message || err.message || 'Publish failed';

    if (isGitHubTokenAccessError(errMsg) && SERVER_URL) {
      try {
        console.warn('[PUBLISH] Direct API failed — falling back to publish workflow via', SERVER_URL);
        purgeExpiredPublishBundles();
        publishBundles.set(jobId, { files: publishFiles, createdAt: Date.now() });
        const wf = await triggerPublishWorkflow({
          internalUserId,
          toolName,
          category: portalCategory,
          toolTitle,
          files: publishFiles,
          jobId,
        });
        publishJobs.set(jobId, {
          status: 'pending',
          toolName,
          internalUserId,
          category: portalCategory,
          pagesUrl: wf.pagesUrl,
          dispatchedAt: Date.now(),
          publishMode: wf.publishMode,
        });
        return res.json({
          jobId,
          publishMode: wf.publishMode,
          warning: 'Opened via GitHub Actions (PUBLISH_PAT/GITHUB_TOKEN lacks direct repo write).',
        });
      } catch (wfErr) {
        console.error('[PUBLISH] workflow fallback failed', wfErr.response?.data || wfErr.message);
      }
    }

    publishJobs.delete(jobId);
    let msg = errMsg;
    if (isGitHubTokenAccessError(msg)) {
      msg = formatPublishTokenHelp();
    } else if (msg === 'Not Found') {
      msg = 'GitHub repo or branch not found — check GITHUB_REPO in .env.';
    }
    res.status(500).json({ error: msg });
  }
});

app.get('/api/publish-bundle/:jobId', (req, res) => {
  const secret = req.headers['x-callback-secret'];
  if (secret !== CALLBACK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  purgeExpiredPublishBundles();
  const bundle = publishBundles.get(req.params.jobId);
  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found or expired' });
  }

  res.json({ files: bundle.files });
});

app.post('/api/publish-complete', async (req, res) => {
  const secret = req.headers['x-callback-secret'];
  if (secret !== CALLBACK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { jobId, prUrl, prNumber, runId } = req.body;
  console.log(`[PUBLISH-CALLBACK] jobId=${jobId} pr=${prNumber} runId=${runId}`);

  const job = publishJobs.get(jobId);
  if (job) {
    publishJobs.set(jobId, {
      ...job,
      status: 'pr_open',
      prUrl,
      prNumber,
      runId,
      actionsUrl: runId ? `https://github.com/${GH_REPO}/actions/runs/${runId}` : undefined,
    });

    if (prUrl && !job.slackNotified) {
      scheduleSlackPrReview(jobId, {
        prUrl,
        prNumber,
        toolName: job.toolName,
        internalUserId: job.internalUserId,
        category: job.category,
      });
    }
  }

  publishBundles.delete(jobId);
  res.json({ ok: true });
});

app.get('/api/publish-status/:jobId', async (req, res) => {
  const job = publishJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  let current = job;

  if (current.status === 'pending') {
    current = await tryResolvePendingPublishJob(current);
    if (current.status !== 'pending') {
      publishJobs.set(req.params.jobId, current);
    }
    return res.json(publicPublishStatus(current));
  }

  if (current.status === 'pr_open' && current.prNumber) {
    try {
      const pr = await ghGet(
        `https://api.github.com/repos/${GH_REPO}/pulls/${current.prNumber}`
      );
      if (pr.merged) {
        publishJobs.set(req.params.jobId, { ...current, status: 'deploying' });
        current = { ...current, status: 'deploying' };
      } else if (pr.state === 'closed') {
        const error = 'PR was closed without merge';
        publishJobs.set(req.params.jobId, { ...current, status: 'failed', error });
        return res.json(publicPublishStatus({ ...current, status: 'failed', error }));
      }
    } catch {
      /* PAT may lack pull_requests:read */
    }
  }

  if (current.status === 'deploying' && current.pagesUrl) {
    const live = await isPagesLive(current.pagesUrl);
    if (live) {
      publishJobs.set(req.params.jobId, { ...current, status: 'merged' });
      return res.json(publicPublishStatus({ ...current, status: 'merged' }));
    }
    return res.json(publicPublishStatus({ ...current, message: 'PR merged — waiting for GitHub Pages deploy' }));
  }

  if (current.status === 'pr_open' && !current.prNumber && current.pagesUrl) {
    // Compare-URL fallback (no PR number): only treat as live after explicit Pages check.
    const live = await isPagesLive(current.pagesUrl);
    if (live) {
      publishJobs.set(req.params.jobId, { ...current, status: 'merged' });
      return res.json(publicPublishStatus({ ...current, status: 'merged' }));
    }
  }

  res.json(publicPublishStatus(current));
});

// 前端輪詢
app.get('/api/build-status/:jobId', (req, res) => {
  const job = buildJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'pending') {
    return res.json({ status: 'pending' });
  }

  res.json({
    status: 'done',
    actionsUrl: job.actionsUrl,
    macArtifactId: job.macArtifactId,
    winArtifactId: job.winArtifactId
  });
});

// Static assets last — API routes must register before this middleware
app.use(express.static(path.join(__dirname)));

app.listen(3000, () => {
  console.log('Server 運行於 http://localhost:3000');
  console.log('[routes] POST /api/publish → GitHub API (branch + PR)');
  if (SLACK_WEBHOOK_URL) {
    console.log('[SLACK] Webhook configured — PR notifications enabled');
  } else {
    console.log('[SLACK] Disabled — set SLACK_WEBHOOK_URL in .env to enable');
  }
});
