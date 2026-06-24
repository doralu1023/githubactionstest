#!/usr/bin/env node
/**
 * Regenerate MALL / AUCTION nav-list sections in toolbox/index.html
 * from toolbox/registry.json and discovered tool directories under toolbox/tools/.
 *
 * Usage: node scripts/update-portal-nav.js [--write-registry-for-new]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TOOLBOX_DIR = path.join(ROOT, 'toolbox');
const TOOLS_DIR = path.join(TOOLBOX_DIR, 'tools');
const REGISTRY_PATH = path.join(TOOLBOX_DIR, 'registry.json');
const PORTAL_HTML = path.join(TOOLBOX_DIR, 'index.html');
const TOOLBOX_TOOLS_URL_PATH = 'toolbox/tools';

const SKIP_DIRS = new Set(['images', '_cdn', 'node_modules']);
const DEFAULT_BASE_URL =
  process.env.GITHUB_PAGES_BASE || 'https://doralu1023.github.io/githubactionstest';

function titleFromSlug(slug) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function readRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { baseUrl: DEFAULT_BASE_URL, tools: {} };
  }
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return {
    baseUrl: raw.baseUrl || DEFAULT_BASE_URL,
    tools: raw.tools || {},
  };
}

function writeRegistry(registry) {
  const payload = {
    baseUrl: registry.baseUrl || DEFAULT_BASE_URL,
    tools: registry.tools || {},
  };
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function discoverToolSlugs() {
  if (!fs.existsSync(TOOLS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(TOOLS_DIR, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && !SKIP_DIRS.has(ent.name))
    .filter((ent) => fs.existsSync(path.join(TOOLS_DIR, ent.name, 'index.html')))
    .map((ent) => ent.name);
}

function syncRegistryWithFilesystem(registry, writeNew) {
  const slugs = discoverToolSlugs();
  let changed = false;
  for (const slug of slugs) {
    if (!registry.tools[slug]) {
      registry.tools[slug] = {
        title: titleFromSlug(slug),
        category: 'mall',
      };
      changed = true;
      console.log(
        `[portal-nav] New tool "${slug}" → default category "mall" (update registry.json to change)`
      );
    }
  }
  if (writeNew && changed) {
    writeRegistry(registry);
  }
  return changed;
}

function buildNavHtml(registry, category) {
  const slugs = discoverToolSlugs()
    .filter((slug) => {
      const meta = registry.tools[slug] || {};
      if (meta.excludeFromNav) return false;
      return (meta.category || 'mall') === category;
    })
    .sort((a, b) => {
      const titleA = (registry.tools[a]?.title || titleFromSlug(a)).toLowerCase();
      const titleB = (registry.tools[b]?.title || titleFromSlug(b)).toLowerCase();
      return titleA.localeCompare(titleB);
    });

  if (slugs.length === 0) {
    return '<li class="nav-item nav-item--empty"><span class="nav-link nav-link--muted">No tools yet</span></li>';
  }

  const base = registry.baseUrl.replace(/\/$/, '');
  return slugs
    .map((slug) => {
      const meta = registry.tools[slug] || {};
      const title = meta.title || titleFromSlug(slug);
      const href = `${base}/${TOOLBOX_TOOLS_URL_PATH}/${slug}/`;
      return `<li class="nav-item"><a class="nav-link" href="${href}">${escapeHtml(title)}</a></li>`;
    })
    .join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function replaceNavSection(html, marker, content) {
  const start = `<!-- NAV:${marker}:START -->`;
  const end = `<!-- NAV:${marker}:END -->`;
  const re = new RegExp(`${escapeRegex(start)}[\\s\\S]*?${escapeRegex(end)}`);
  if (!re.test(html)) {
    throw new Error(`Missing nav markers NAV:${marker} in ${PORTAL_HTML}`);
  }
  return html.replace(re, `${start}\n${content}\n${end}`);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const writeRegistryForNew = process.argv.includes('--write-registry-for-new');

  if (!fs.existsSync(PORTAL_HTML)) {
    console.error(`[portal-nav] Portal not found: ${PORTAL_HTML}`);
    process.exit(1);
  }

  if (!fs.existsSync(TOOLS_DIR)) {
    fs.mkdirSync(TOOLS_DIR, { recursive: true });
    console.log(`[portal-nav] Created empty tools directory: ${TOOLS_DIR}`);
  }

  const registry = readRegistry();
  syncRegistryWithFilesystem(registry, writeRegistryForNew);

  let html = fs.readFileSync(PORTAL_HTML, 'utf8');
  const mallNav = buildNavHtml(registry, 'mall');
  const auctionNav = buildNavHtml(registry, 'auction');

  html = replaceNavSection(html, 'MALL', mallNav);
  html = replaceNavSection(html, 'AUCTION', auctionNav);

  fs.writeFileSync(PORTAL_HTML, html, 'utf8');
  console.log(
    `[portal-nav] Updated ${PORTAL_HTML} — mall: ${mallNav.split('nav-item').length - 1}, auction: ${auctionNav.split('nav-item').length - 1}`
  );
}

module.exports = { updatePortalNav: main };

if (require.main === module) {
  main();
}
