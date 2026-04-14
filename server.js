require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');
const app = express();
const crypto = require('crypto');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// 儲存 build 狀態（記憶體，重啟會清空，測試夠用）
const buildJobs = new Map();
// { jobId: { status: 'pending'|'done', runId, macUrl, winUrl } }

const CALLBACK_SECRET = process.env.CALLBACK_SECRET;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO = process.env.GITHUB_REPO;
const SERVER_URL = process.env.SERVER_URL; // e.g. http://localhost:3000

// 首頁
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'sandbox_v3.html'));
});

// bundleScripts：把外部 CDN script 下載內嵌
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

    res.json({
      message: '已觸發編譯，請前往 GitHub Actions 下載成品',
      actionsUrl: `https://github.com/${GH_REPO}/actions/workflows/build.yml`
    });

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: '觸發 GitHub Actions 失敗' });
  }
});

// 觸發 workflow
app.post('/api/package', async (req, res) => {
    let { htmlContent, toolName } = req.body;
    htmlContent = await bundleScripts(htmlContent);
  
    const outputFileName = toolName
      .replace(/\.(html|htm)$/i, '')
      .replace(/\s+/g, '_');
  
    const htmlBase64 = Buffer.from(htmlContent).toString('base64');
    const jobId = `${outputFileName}-${Date.now()}`;
  
    // 存入 pending 狀態
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
  
    // 從 GitHub API 拿 Artifact 下載連結
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
  
  // 前端輪詢
  app.get('/api/build-status/:jobId', (req, res) => {
    const job = buildJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
  
    if (job.status === 'pending') {
      return res.json({ status: 'pending' });
    }
  
    // Artifact 要登入才能下載，給 actionsUrl 讓使用者去 GitHub 下載
    // 或用 GH_TOKEN 產生 download URL（需要額外一步）
    res.json({
      status: 'done',
      actionsUrl: job.actionsUrl,
      macArtifactId: job.macArtifactId,
      winArtifactId: job.winArtifactId
    });
  });

app.listen(3000, () => console.log('Server 運行於 http://localhost:3000'));