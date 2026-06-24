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

const CALLBACK_SECRET = process.env.CALLBACK_SECRET;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO = process.env.GITHUB_REPO;
const SERVER_URL = process.env.SERVER_URL;

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

function pagesUrlFor(supplierId, toolName) {
  const supplierSlug = slugify(supplierId);
  const toolSlug = slugify(toolName);
  return `${GITHUB_PAGES_BASE}/tools/${supplierSlug}/${toolSlug}/`;
}

/**
 * Trigger publish.yml — uses Actions GITHUB_TOKEN (Contents + PR write), not the server PAT.
 */
async function triggerPublishWorkflow({ supplierId, toolName, htmlContent, jobId }) {
  const supplierSlug = slugify(supplierId);
  const toolSlug = slugify(toolName);
  const htmlBase64 = Buffer.from(htmlContent, 'utf-8').toString('base64');

  await axios.post(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/publish.yml/dispatches`,
    {
      ref: 'main',
      inputs: {
        supplier_id: supplierSlug,
        tool_name: toolSlug,
        html_base64: htmlBase64,
        job_id: jobId,
        callback_url: `${SERVER_URL}/api/publish-complete`,
      },
    },
    { headers: ghHeaders }
  );

  return {
    pagesUrl: pagesUrlFor(supplierId, toolName),
    supplierSlug,
    toolSlug,
  };
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'sandbox_v3.html'));
});

// Okta session stub — replace with real OIDC middleware in production
app.get('/api/auth/me', (req, res) => {
  res.json({
    authenticated: false,
    provider: 'okta',
    email: '',
    name: 'Guest',
    canSwitchRoles: false,
    defaultAppRole: 'supplier',
    primaryRole: 'supplier',
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
  const { supplierId, toolName, htmlContent, files } = req.body;

  if (!supplierId || !toolName) {
    return res.status(400).json({ error: 'supplierId and toolName are required' });
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

  const indexFile =
    bundleFiles.find((f) => f.path === 'index.html' || /\.html?$/i.test(f.path)) ||
    bundleFiles[0];

  const jobId = `publish-${slugify(toolName)}-${Date.now()}`;
  const pagesUrl = pagesUrlFor(supplierId, toolName);

  publishJobs.set(jobId, { status: 'pending', toolName, supplierId, pagesUrl });

  try {
    await triggerPublishWorkflow({
      supplierId,
      toolName,
      htmlContent: indexFile.content,
      jobId,
    });

    res.json({ jobId, pagesUrl });
  } catch (err) {
    console.error('[PUBLISH]', err.response?.data || err.message);
    publishJobs.delete(jobId);
    const ghMsg = err.response?.data?.message;
    let msg = ghMsg || err.message || 'Publish failed';
    if (ghMsg === 'Not Found') {
      msg =
        'publish.yml not found on main — push .github/workflows/publish.yml to GitHub first.';
    }
    res.status(500).json({ error: msg });
  }
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
  }

  res.json({ ok: true });
});

app.get('/api/publish-status/:jobId', async (req, res) => {
  const job = publishJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'pending') {
    return res.json({ status: 'pending' });
  }

  if (job.status === 'pr_open' && job.pagesUrl) {
    const live = await isPagesLive(job.pagesUrl);
    if (live) {
      publishJobs.set(req.params.jobId, { ...job, status: 'merged' });
      return res.json({
        status: 'merged',
        prUrl: job.prUrl,
        pagesUrl: job.pagesUrl,
      });
    }
  }

  if (job.prNumber && job.status === 'pr_open') {
    try {
      const pr = await ghGet(
        `https://api.github.com/repos/${GH_REPO}/pulls/${job.prNumber}`
      );
      if (pr.merged) {
        publishJobs.set(req.params.jobId, { ...job, status: 'merged' });
        return res.json({
          status: 'merged',
          prUrl: job.prUrl,
          pagesUrl: job.pagesUrl,
        });
      }
    } catch {
      /* PAT may lack pull_requests:read — fall back to pages HEAD check above */
    }
  }

  res.json({
    status: job.status,
    prUrl: job.prUrl,
    pagesUrl: job.pagesUrl,
    actionsUrl: job.actionsUrl,
  });
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
  console.log('[routes] POST /api/publish → workflow publish.yml');
});