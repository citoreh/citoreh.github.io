# citoreh.github.io

Showreel of my public projects. Live at https://citoreh.github.io

## How it updates

A GitHub Action (`.github/workflows/showreel.yml`) runs every day, on demand from the Actions tab, and whenever `projects.json` or the build script changes. It:

1. Lists every public repo on the account.
2. Screenshots each repo's live page (its homepage, or its GitHub Pages site) into `thumbs/`. A screenshot is retaken only when the repo has new commits. Run the workflow manually with "Retake every screenshot" to redo them all.
3. Writes `repos.json`, which `index.html` reads.

Repos without a live page get a generated pattern instead of a screenshot.

## Controlling what appears

- **New public repos appear automatically.** Title, description and tags come from, in order: `projects.json`, the repo's GitHub description and topics, then the live page's title and description.
- **Category** comes from `projects.json`, otherwise from GitHub topics: `chrome-extension`, `generative`, `creative-tool`, `audio`, `persian-cinema`, `subtitles`, `archive`, `publishing`, `website`. Forks are grouped automatically. Anything else goes under "Other".
- **Hide a repo** by giving it the topic `hide-from-showreel`, or `"hide": true` in `projects.json`.
- **Curate a repo** by adding an entry to `projects.json`. Fields: `title`, `fa` (Persian title), `category` (`studio`, `ext`, `cinema`, `pub`, `fork`, `other`), `description`, `tags`, `live` (a URL, or `false` for no live link), `hide`.

## Local build

```
npm install && npx playwright install chromium
npm run build
```
