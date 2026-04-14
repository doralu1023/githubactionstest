require('dotenv').config();
const axios = require('axios');

const GH_TOKEN = process.env.GITHUB_TOKEN;
const GH_REPO = process.env.GITHUB_REPO; // 'username/repo-name'

// 觸發 workflow
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