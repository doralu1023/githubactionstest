require('dotenv').config();
const express = require('express');
const axios = require('axios');
const https = require('https');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO = process.env.GITHUB_REPO;

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
          tool_name: outputFileName
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

app.listen(3000, () => console.log('Server 運行於 http://localhost:3000'));