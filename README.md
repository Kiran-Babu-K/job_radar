# Job Radar

**A self-updating job search dashboard that finds roles, scores fit, and drafts a truthful, tailored CV for the ones worth applying to — running entirely on free-tier APIs, in your own GitHub account.**

This is a fork-and-run project. There's no shared backend, no subscription, and nothing tied to any particular AI vendor's account — everyone who forks it gets their own data, their own search criteria, and their own free API keys.

---

## What it does

- **Searches automatically, every 6 hours** (configurable) — via [Adzuna's](https://developer.adzuna.com/) free job-search API, scoped to whatever job titles and location you configure
- **Scores every posting for fit (0–10)** against *your* real work history, using a free-tier LLM (Google Gemini or Groq — your choice) — nothing is scored against anyone else's background
- **Drafts a tailored CV** for postings that clear your fit threshold, built exclusively from the real accomplishments you provide — the model is explicitly instructed to only reorder and reword them, never to invent a skill, number, or responsibility
- **Tracks a 10-stage application pipeline** per job (new match → shortlisted → applied → follow-up → interview → offer → closed), saved in your own browser
- **Flags salary estimates honestly** — a posting below your stated floor, or one with no disclosed salary, is flagged rather than hidden or guessed at silently
- **"Search now" on demand** — trigger a run immediately from the dashboard instead of waiting for the schedule, via GitHub's own API
- **View / print any tailored CV** straight from the browser — no document-generation service involved, just the page rendering it and your browser's own print-to-PDF

## Who gets what data

Short answer: **you get your own.** Longer answer, because this is worth being precise about:

- **Your search criteria and real experience** live in `config.json`, a file *you* create in *your own fork* from `config.example.json`. It's never bundled into this repo's history upstream — you add it after forking.
- **The job search and scoring** run inside *your* fork's GitHub Actions, using *your* free API keys (stored as secrets in your fork, never in code). They only ever see the profile in your `config.json`.
- **The results** (`data/jobs.json`) are committed back to *your* fork by *your* workflow run — a plain JSON file only your repo produces.
- **Your application-stage tracking** (shortlisted, applied, interview, etc.) is saved in `localStorage` in *your own browser* — it never leaves your machine, and isn't shared with anyone viewing your public GitHub Pages URL unless they're using your exact browser profile.
- **The on-demand "Search now" trigger** uses a GitHub personal access token *you* generate and paste into the dashboard, stored only in your browser's local storage, sent only to `api.github.com`.

Nothing here depends on any Claude account, any Anthropic API key, or any other proprietary AI subscription. If you clone this repo and set it up per the steps below, you get a fully independent instance running your own search under your own name.

## Setup

1. **Fork this repo.**
2. **Get free API credentials:**
   - [Adzuna](https://developer.adzuna.com/) — free developer account, gives you an `app_id` and `app_key`
   - [Google AI Studio](https://aistudio.google.com/app/apikey) (for Gemini) **or** [Groq Console](https://console.groq.com/keys) (for Groq) — either has a free tier
3. **Add repo secrets** — in your fork, go to *Settings → Secrets and variables → Actions* and add:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
   - `LLM_API_KEY` (your Gemini or Groq key)
4. **Create your `config.json`:**
   - Easiest: open your fork's GitHub Pages site (see step 5) and use the **Search settings** tab — fill in your real name, contact details, target job titles, location, salary floor, and real work-experience bullets, then click **Generate config.json** and **Download**.
   - Or: copy `config.example.json` to `config.json` by hand and fill it in.
   - Commit `config.json` to your fork's `main` branch (it needs to be readable by the GitHub Actions workflow — don't add it to `.gitignore`).
5. **Enable GitHub Pages** — *Settings → Pages → Build and deployment → Deploy from a branch* → branch `main`, folder `/ (root)`. Your dashboard will be live at `https://<you>.github.io/<repo>/`.
6. **Run it once** — *Actions* tab → *Job Radar search* → *Run workflow*, or wait for the next scheduled run (every 6 hours). Once it finishes, `data/jobs.json` will have your first matches and refresh the dashboard automatically.
7. *(Optional)* **Set up "Search now" from the dashboard** — go to the **Automation** tab, enter your `owner/repo` and a GitHub personal access token (fine-grained, scoped to this one repo, with just the *Actions: write* permission), and click **Save**. Now the **Search now** button in the header can trigger a run without visiting GitHub at all.

## How it works

Two halves, both living in your own fork:

1. **The dashboard** (`index.html`) — a static, single-file page. It `fetch`es `data/jobs.json`, renders the list, stats and controls, and keeps your stage changes in `localStorage`. No backend of its own — GitHub Pages just serves the file.
2. **The search pipeline** (`scripts/search.mjs`, run by `.github/workflows/job-search.yml`) — a dependency-free Node script (uses only the built-in `fetch`) that:
   - Reads `config.json`
   - Searches Adzuna for each configured job title
   - Sends every new posting to your chosen LLM with your real profile, asking for a 0–10 fit score and, above your threshold, a tailored CV built only from your supplied bullets
   - Commits the merged results to `data/jobs.json`, never regressing a stage that's already been set on a prior run

### Tech stack

- **Frontend:** vanilla HTML/CSS/JS, one file, no build step, no framework
- **Job search:** [Adzuna](https://developer.adzuna.com/) free-tier API
- **Scoring & CV tailoring:** your choice of [Gemini](https://ai.google.dev/) or [Groq](https://groq.com/) free-tier LLM APIs
- **Scheduling:** GitHub Actions (`schedule: cron`), plus `workflow_dispatch` for on-demand runs
- **Data storage:** a single committed `data/jobs.json` — no database
- **Stage tracking:** `localStorage`, per browser, per person
- **CV output:** rendered client-side from the LLM's structured JSON, printed to PDF via the browser's own `window.print()` — no document-conversion pipeline required

## Design decisions worth calling out

- **No fake auto-submit.** This never holds a real login or submits an application unattended. Every "Apply / view posting" link opens the real posting; every send is a real click from a real person.
- **No fabricated CV content.** The scoring/tailoring prompt explicitly instructs the model to draw only on the bullets you supply, and to only reorder or reword them — never invent a skill, number, or accomplishment. This is enforced by instruction, not by code, so it's only as reliable as the model's instruction-following — spot-check your generated CVs before relying on them.
- **Stage tracking lives in your browser, not a shared file.** There's no backend to hold per-person state safely, so `localStorage` is the honest choice — it's genuinely private to you, at the cost of not syncing across devices.
- **The on-demand trigger asks for a scoped token, with a caveat stated plainly.** Storing any token in browser `localStorage` is an XSS-adjacent risk in general (any script that can run on the page could read it). Scoping it to one repo and one permission bounds the damage if that ever happens; nothing here makes that risk zero.
- **Free-tier limits are real limits.** Adzuna, Gemini and Groq all cap free usage. The default 6-hour schedule is a conservative starting point — watch your usage and adjust the cron expression in `.github/workflows/job-search.yml` if you hit a ceiling.

## Repo contents

```
index.html                        — the dashboard (all HTML/CSS/JS in one file)
config.example.json               — the config schema; copy to config.json and fill in your real details
data/jobs.json                    — search results, written by the GitHub Actions workflow
scripts/search.mjs                — the search + scoring + CV-tailoring pipeline (Node, no dependencies)
.github/workflows/job-search.yml  — the scheduled + on-demand GitHub Actions workflow
README.md                         — this file
LICENSE                           — MIT
```

## License

MIT — fork it, adapt it, make it your own job search tool.

## Author

Originally built by **Kiran Babu Kannan** — Program Manager / Business Operations, 10+ years across EdTech, Healthcare, BFSI, and SaaS.
[LinkedIn](https://linkedin.com/in/kiran-babu-k)
