# Job Radar

**A self-updating job search dashboard that finds roles, scores fit, tailors a CV, and tracks the pipeline — automatically, every 2 hours.**

🔗 **Live demo:** https://claude.ai/artifact/AvMzHZ4MAbUmKzAYqWAjBM
*(private artifact — request access, or see [How this actually runs](#how-this-actually-runs) below for why you can't just clone this repo and run it elsewhere)*

---

## The problem

Job searching at scale means the same repetitive loop, over and over: search 4–5 portals for roles that fit a fairly specific set of criteria, judge whether each one is actually worth applying to, write a tailored CV for the ones that are, and keep track of where every application stands. Doing that by hand for dozens of roles a week doesn't scale, and generic "spray and pray" applications with one CV do worse than tailored ones.

Job Radar automates the parts that are mechanical (searching, scoring, drafting) while keeping a human in the loop for the part that shouldn't be automated (actually clicking "Apply").

## What it does

- **Searches automatically, every 2 hours** — Indeed, Naukri, iimjobs, and general web search, scoped to Bengaluru and a defined set of target role families (Process Excellence, Program Management, Business Analyst, Customer Success, Strategy & Ops, SLA Delivery Ops), with a ₹18L salary floor
- **Scores every posting for fit (0–10)** against real work history, and only surfaces postings that clear a 6/10 bar
- **Auto-generates a tailored, truthful CV** for every qualifying match — same fixed visual template, content re-weighted per role from a fixed library of real, factual bullet points (nothing invented)
- **Tracks a 10-stage application pipeline** per job (new match → shortlisted → applied → follow-up → interview → offer → closed), editable inline
- **Flags salary estimates and "quick-apply" postings honestly** — quick-apply means the job board offers one-click apply, not that this dashboard can submit anything on your behalf; every application still needs a real click from a real person
- **One-click manual trigger** — a "Search now & generate CVs" button fires the same pipeline on demand, for when you don't want to wait for the next scheduled run
- **Sidebar-navigable views** — Overview, Job matches, Applications (already-applied jobs only), CV library (jobs with a CV ready), Automation (what the scheduler is doing and why), Search settings (the live criteria in plain English)

## How it works

Job Radar has two halves:

1. **The dashboard** (`job_radar.html`) — a single-file page that renders the job list, stats, and controls, and reads/writes its data live from a small shared database. No backend server of its own.
2. **The scheduled search** — a background job that fires every 2 hours (or on demand from the dashboard's button), which:
   - Searches the configured sources for new postings
   - Scores each one against a real candidate profile and discards anything under the fit threshold
   - Applies the salary floor (discarding postings confirmed below it, flagging ones where pay isn't disclosed and had to be estimated)
   - For qualifying new matches, generates a tailored CV as a `.docx` → `.pdf` and uploads it
   - Writes/updates job records in the shared database, without ever regressing a stage the user has already advanced manually

### Tech stack

- **Frontend:** vanilla HTML/CSS/JS — no framework, no build step, one file
- **Data layer:** a small shared JSON document store, live-synced to every open view (`onSnapshot`-style subscriptions)
- **File storage:** generated CV PDFs are uploaded to per-artifact asset storage and linked from each job record
- **On-demand trigger:** the dashboard's "Search now" button calls out to a connector tool to fire the scheduled job immediately, with clear on-page error messages if that connector isn't available
- **CV generation:** Node.js (`docx` library) building a fixed-layout document from a real, truthful bullet-point library per employer, converted to PDF
- **Scheduling:** a cron-style scheduled task (`33 */2 * * *`) that runs the search-and-generate pipeline as a fresh, fully self-contained job every 2 hours

## Design decisions worth calling out

- **No fake auto-submit.** An earlier draft of this spec asked for one-click auto-apply on qualifying matches. That was deliberately *not* built as literally specified — no browser session here can safely hold a person's real job-site login and submit applications unattended. Instead, quick-apply-eligible postings are tagged honestly, and every apply link still requires the person to click it themselves.
- **No fabricated CV content.** Every CV is built from a fixed library of true, previously-verified accomplishments per employer. The system re-weights *which* truths to lead with per role — it never invents a skill, number, or responsibility.
- **Honest capability disclosure in the UI itself.** The dashboard tells you plainly what it can't do yet (no connected email inbox, no auto-follow-ups) rather than showing a toggle that doesn't work.

## How this actually runs

This isn't a static site you can `npm start` — `job_radar.html` is built for [Claude's Artifact runtime](https://www.anthropic.com/claude), which is what provides the shared database, file storage, and connector-calling capabilities the page uses (`window.claude.use(...)`). Opening the raw HTML file in a browser by itself will render the layout but none of the live data or actions will work, because there's no backend behind it outside that runtime.

The scheduled search pipeline similarly runs as a Claude scheduled task, not a cron job on a server you'd host yourself.

If you want to see it working rather than reading about it, use the live demo link above.

## Repo contents

```
job_radar.html   — the dashboard (all HTML/CSS/JS in one file)
README.md        — this file
```

## License

MIT — feel free to read, learn from, or adapt the approach for your own job search tooling.

## Author

Built by **Kiran Babu Kannan** — Program Manager / Business Operations, 10+ years across EdTech, Healthcare, BFSI, and SaaS.
[LinkedIn](https://linkedin.com/in/kiran-babu-k)
