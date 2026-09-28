# Job Radar

**A self-updating job search dashboard that finds roles, scores fit, and drafts a truthful, tailored CV for the ones worth applying to — running on free-tier APIs in your own GitHub account.**

This project has a static dashboard, a scheduled search/scoring pipeline, and a JSON store for job results.

## Features

- Searches configured job titles and location through the Adzuna API.
- Scores job fit from 0–10 using Gemini or Groq.
- Drafts tailored CV content from the candidate's supplied experience only.
- Tracks application stages in browser local storage.
- Flags salary-floor mismatches and undisclosed salary.
- Supports scheduled searches and manual GitHub Actions workflow dispatch.
- Displays job results from `data/jobs.json`.

## Setup

1. Fork or clone this repository.
2. Create your own `config.json` from `config.example.json` and fill it with your real profile, target roles, location, salary floor, and experience.
3. Get API credentials from [Adzuna](https://developer.adzuna.com/) and either [Google AI Studio](https://aistudio.google.com/app/apikey) or [Groq](https://console.groq.com/keys).
4. Add repository Actions secrets named `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, and `LLM_API_KEY`.
5. Enable GitHub Pages for branch `main`, folder `/(root)`.
6. In Actions, run **Job Radar search** manually once or wait for its six-hour schedule.

## Repository files

- `index.html` — dashboard (HTML, CSS, and JavaScript in one static page).
- `config.example.json` — configuration template. Copy it to `config.json` and add your own information.
- `data/jobs.json` — job search results, updated by the workflow.
- `scripts/search.mjs` — Adzuna search, fit scoring, and CV tailoring pipeline.
- `.github/workflows/job-search.yml` — scheduled and manually triggered workflow.
- `LICENSE` — MIT License.

## API and privacy notes

API keys should be stored as GitHub Actions secrets, not in source files. Your personal profile belongs in your own `config.json`; do not commit sensitive information to a public repository. Application-stage tracking is stored in the browser's local storage. The dashboard's optional on-demand trigger may store a GitHub token in local storage, which has security trade-offs; use a narrowly scoped token and avoid using it on untrusted pages.

## Safety and accuracy

The CV prompt instructs the model to use only supplied experience and not invent achievements, skills, or numbers. This is a prompt-level safeguard, not a guarantee; review generated CVs before using them. Job listings and salary details may be incomplete or change after discovery.

## License

MIT.

## Author

Originally built by **Kiran Babu Kannan**. [LinkedIn](https://linkedin.com/in/kiran-babu-k)
