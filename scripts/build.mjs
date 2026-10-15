// Builds repos.json and thumbs/ for the showreel.
// 1. Lists every public repo owned by OWNER.
// 2. Merges each with projects.json overrides.
// 3. Screenshots each live page (only when the repo changed since the last shot, or FORCE_SHOTS=1).
//
// Env: OWNER (default citoreh), GITHUB_TOKEN (optional, raises rate limit),
//      FORCE_SHOTS=1, SKIP_SHOTS=1, FIXTURE=path/to/repos-api.json (offline test)

import fs from "node:fs/promises";
import path from "node:path";

const OWNER = process.env.OWNER || "citoreh";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE_REPO = `${OWNER}.github.io`.toLowerCase();
const HIDE_TOPIC = "hide-from-showreel";
const THUMB_DIR = path.join(ROOT, "thumbs");

// GitHub topic -> showreel category. First match wins.
const TOPIC_CATEGORIES = [
  ["ext", ["chrome-extension", "browser-extension", "extension"]],
  ["studio", ["generative", "generative-art", "creative-tool", "creative-coding", "studio", "audio", "music"]],
  ["cinema", ["persian-cinema", "cinema", "film", "movies", "subtitles", "archive"]],
  ["pub", ["publishing", "books", "epub", "website", "site"]],
];

const readJSON = async (p, fallback) => {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return fallback; }
};

async function listRepos() {
  if (process.env.FIXTURE) return readJSON(process.env.FIXTURE, []);
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "showreel-build" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const all = [];
  for (let page = 1; page < 20; page++) {
    const res = await fetch(`https://api.github.com/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function categorize(repo) {
  if (repo.fork) return "fork";
  const topics = repo.topics || [];
  for (const [cat, keys] of TOPIC_CATEGORIES) if (topics.some(t => keys.includes(t))) return cat;
  return "other";
}

const prettify = name => name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, c => c.toUpperCase());

async function main() {
  const overrides = (await readJSON(path.join(ROOT, "projects.json"), { projects: {} })).projects || {};
  const previous = await readJSON(path.join(ROOT, "repos.json"), { repos: [] });
  const prevByName = Object.fromEntries((previous.repos || []).map(r => [r.name, r]));
  await fs.mkdir(THUMB_DIR, { recursive: true });

  const raw = await listRepos();
  const repos = [];
  for (const r of raw) {
    if (r.private || r.visibility === "private") continue;
    if (r.name.toLowerCase() === SITE_REPO) continue;
    if ((r.topics || []).includes(HIDE_TOPIC)) continue;
    const o = overrides[r.name] || {};
    if (o.hide) continue;
    const prev = prevByName[r.name] || {};

    let live = null;
    if (o.live === false) live = null;
    else if (typeof o.live === "string") live = o.live;
    else if (r.homepage && /^https?:\/\//.test(r.homepage)) live = r.homepage;
    else if (r.has_pages) live = `https://${OWNER}.github.io/${r.name}/`;

    repos.push({
      name: r.name,
      title: o.title || prev.pageTitle || prettify(r.name),
      fa: o.fa || "",
      category: o.category || categorize(r),
      description: o.description || r.description || prev.pageDescription || "",
      hasOwnTitle: !!o.title,
      hasOwnDescription: !!(o.description || r.description),
      pageTitle: prev.pageTitle || "",
      pageDescription: prev.pageDescription || "",
      tags: o.tags || (r.topics || []).filter(t => t !== HIDE_TOPIC).slice(0, 3).map(t => t.replace(/-/g, " ")),
      language: r.language || "",
      pushed: (r.pushed_at || "").slice(0, 10),
      pushedAt: r.pushed_at || "",
      fork: !!r.fork,
      repo: r.html_url,
      live,
      thumb: prev.thumb || null,
      shotAt: prev.shotAt || null,
    });
  }

  if (!process.env.SKIP_SHOTS) await shoot(repos);

  // Drop thumbnails for repos that left the list.
  const keep = new Set(repos.map(r => r.thumb).filter(Boolean));
  for (const f of await fs.readdir(THUMB_DIR)) if (!keep.has(`thumbs/${f}`)) await fs.rm(path.join(THUMB_DIR, f));

  repos.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
  for (const r of repos) { if (!r.description) r.description = "No description yet."; delete r.hasOwnTitle; delete r.hasOwnDescription; }
  const out = { owner: OWNER, generated: new Date().toISOString(), count: repos.length, repos };
  await fs.writeFile(path.join(ROOT, "repos.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`repos.json: ${repos.length} repos, ${repos.filter(r => r.thumb).length} with screenshots`);
}

async function shoot(repos) {
  const force = process.env.FORCE_SHOTS === "1";
  const todo = repos.filter(r => r.live && !r.fork && (force || !r.thumb || !r.shotAt || r.shotAt < r.pushedAt));
  if (!todo.length) { console.log("Screenshots: nothing changed"); return; }
  let browser;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  } catch (e) {
    console.log(`Screenshots skipped, browser unavailable: ${e.message.split("\n")[0]}`);
    return;
  }
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
  for (const r of todo) {
    const page = await ctx.newPage();
    try {
      const res = await page.goto(r.live, { waitUntil: "networkidle", timeout: 30000 });
      if (!res || res.status() >= 400) throw new Error(`HTTP ${res && res.status()}`);
      await page.waitForTimeout(2000); // let canvases and intro animations settle
      const info = await page.evaluate(() => {
        const clean = s => (s || "").replace(/\s+/g, " ").trim();
        const meta = document.querySelector('meta[name="description"]')?.content ||
          document.querySelector('meta[property="og:description"]')?.content;
        const para = [...document.querySelectorAll("p")].map(p => clean(p.innerText)).find(t => t.length > 40);
        return { desc: clean(meta) || para || "", title: clean(document.title) };
      });
      if (info.desc) {
        r.pageDescription = info.desc.length > 220 ? info.desc.slice(0, 217).replace(/\s\S*$/, "") + "…" : info.desc;
        if (!r.hasOwnDescription) r.description = r.pageDescription;
      }
      if (info.title && !r.hasOwnTitle) { r.pageTitle = info.title.split(/\s[—|·:-]\s/)[0]; r.title = r.pageTitle; }
      const file = `thumbs/${r.name}.jpg`;
      await page.screenshot({ path: path.join(ROOT, file), type: "jpeg", quality: 72 });
      r.thumb = file;
      r.shotAt = new Date().toISOString();
      console.log(`  shot ${r.name}`);
    } catch (e) {
      console.log(`  skip ${r.name}: ${e.message}`);
    } finally { await page.close(); }
  }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
