#!/usr/bin/env node
/**
 * Job Radar — search & score pipeline.
 *
 * Runs entirely on free-tier APIs, with zero npm dependencies (Node 18+'s
 * built-in `fetch` only), so it works unmodified inside GitHub Actions'
 * `ubuntu-latest` runner.
 *
 * What it does, in order:
 *   1. Reads config.json (candidate profile + search criteria + LLM choice).
 *   2. Searches Adzuna for each configured job title, in the configured
 *      country/location.
 *   3. For every posting not already in data/jobs.json, asks the configured
 *      free-tier LLM (Gemini or Groq) to score it 0–10 against the
 *      candidate's REAL profile only, and — if it clears the fit threshold —
 *      to produce a tailored CV built exclusively from the candidate's own
 *      supplied bullets (reordered/reworded, never invented).
 *   4. Merges everything into data/jobs.json, without ever regressing a
 *      `stage` the user has already set by hand (e.g. "applied", "interview").
 *
 * Required environment variables (set as GitHub repo secrets):
 *   ADZUNA_APP_ID   — free Adzuna API app id
 *   ADZUNA_APP_KEY  — free Adzuna API app key
 *   LLM_API_KEY     — API key for whichever provider config.json.llm.provider names
 *
 * Usage: node scripts/search.mjs
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
const JOBS_PATH = path.join(ROOT, "data", "jobs.json");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function slugify(...parts) {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function extractFirstJsonObject(text) {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to grabbing the outermost {...} block, in case the model
    // added stray prose before/after the JSON.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new Error("No JSON object found in model response");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// ---------------------------------------------------------------------------
// Step 1: config
// ---------------------------------------------------------------------------

async function loadConfig() {
  let config;
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "config.json not found. Copy config.example.json to config.json, fill in your " +
          "real details, and commit it (see README.md)."
      );
    }
    throw err;
  }

  const required = [
    ["candidate", "name"],
    ["search", "titles"],
    ["search", "location"],
    ["search", "country"],
    ["llm", "provider"],
    ["profile", "experience"],
  ];
  for (const pathParts of required) {
    let v = config;
    for (const p of pathParts) v = v?.[p];
    if (v === undefined || v === null || v === "") {
      throw new Error(`config.json is missing required field: ${pathParts.join(".")}`);
    }
  }
  if (!Array.isArray(config.search.titles) || config.search.titles.length === 0) {
    throw new Error("config.json search.titles must be a non-empty array");
  }
  return config;
}

// ---------------------------------------------------------------------------
// Step 2: Adzuna job search
// ---------------------------------------------------------------------------

async function searchAdzuna(config) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    throw new Error(
      "ADZUNA_APP_ID / ADZUNA_APP_KEY environment variables are not set. " +
        "Get free credentials at https://developer.adzuna.com/ and add them as repo secrets."
    );
  }

  const country = (config.search.country || "in").toLowerCase();
  const results = [];

  for (const title of config.search.titles) {
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("what", title);
    url.searchParams.set("where", config.search.location);
    url.searchParams.set("results_per_page", "20");
    url.searchParams.set("content-type", "application/json");

    log(`Searching Adzuna for "${title}" in "${config.search.location}"...`);
    let res;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      log(`  Adzuna request failed for "${title}": ${err.message}`);
      continue;
    }
    if (!res.ok) {
      log(`  Adzuna returned ${res.status} for "${title}": ${await res.text().catch(() => "")}`);
      continue;
    }
    const data = await res.json();
    for (const item of data.results || []) {
      results.push({
        id: `adzuna-${item.id}`,
        title: item.title?.replace(/<[^>]+>/g, "").trim() || "Untitled role",
        company: item.company?.display_name || "Unknown company",
        location: item.location?.display_name || config.search.location,
        url: item.redirect_url,
        description: (item.description || "").replace(/<[^>]+>/g, "").trim(),
        salaryMin: item.salary_min ?? null,
        salaryMax: item.salary_max ?? null,
        salaryDisclosed: Boolean(item.salary_min || item.salary_max),
        source: "Adzuna",
        postedAt: item.created || null,
        searchTitle: title,
      });
    }
    log(`  found ${data.results?.length ?? 0} postings`);
  }

  // De-duplicate by id (same posting can surface under multiple title searches)
  const byId = new Map();
  for (const r of results) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Step 3: LLM scoring + CV tailoring
// ---------------------------------------------------------------------------

function buildProfileBlock(config) {
  const p = config.profile;
  const experience = (p.experience || [])
    .map(
      (job, i) =>
        `Job ${i + 1}: ${job.role} at ${job.company} (${job.location}, ${job.dates})\n` +
        (job.bullets || []).map((b) => `  - ${b}`).join("\n")
    )
    .join("\n\n");

  return [
    `Education: ${p.education || "(not provided)"}`,
    `Certifications: ${(p.certifications || []).join("; ") || "(none provided)"}`,
    ``,
    `Real work experience (the ONLY facts you may draw on):`,
    experience,
  ].join("\n");
}

function buildPrompt(job, config) {
  const c = config.candidate;
  const profileBlock = buildProfileBlock(config);
  const salaryFloor = config.search.salaryFloor
    ? `${config.search.currency || ""} ${config.search.salaryFloor}`.trim()
    : "(not set)";

  return `You are helping a real job seeker evaluate ONE job posting and, if it's a good fit, tailor their CV.

CANDIDATE (${c.name}):
${profileBlock}

Salary floor: ${salaryFloor}. Fit threshold to clear: ${config.scoring?.fitThreshold ?? 6}/10.

JOB POSTING:
Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Salary disclosed: ${job.salaryDisclosed ? `${job.salaryMin ?? "?"}-${job.salaryMax ?? "?"}` : "not disclosed"}
Description:
${job.description.slice(0, 4000)}

STRICT RULES:
- Score fit 0-10 based ONLY on how well the candidate's REAL experience above matches this posting.
- Never invent, exaggerate, or infer skills, numbers, titles, or accomplishments the candidate did not state above.
- If you generate a tailored CV, you may only REORDER and REWORD the bullets already given above (choosing which existing bullets to lead with per job) — never add a new bullet, number, or claim.
- If fit is below the threshold, you do NOT need to produce a CV — just the score and a one-sentence reason.

Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:
{
  "fitScore": <integer 0-10>,
  "reason": "<one sentence, plain English, why this score>",
  "salaryFlag": "<'below_floor' | 'meets_floor' | 'undisclosed_estimate' | 'not_applicable'>",
  "cv": null | {
    "headline": "<role-style headline, plain text, no company name>",
    "summary": "<one paragraph, built only from the real experience above>",
    "competencies": "<pipe-separated skill groups, drawn only from the real experience above>",
    "experience": [
      { "company": "...", "role": "...", "location": "...", "dates": "...", "bullets": ["...", "..."] }
    ],
    "education": "<copy from candidate profile>",
    "certifications": ["<copy from candidate profile>"]
  }
}
Set "cv" to null if fitScore is below the threshold.`;
}

async function callGemini(prompt, model, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function callGroq(prompt, model, apiKey) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq API error ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq returned no text");
  return text;
}

async function callLLM(prompt, llmConfig) {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "LLM_API_KEY environment variable is not set. Add a free Gemini or Groq API key as a repo secret."
    );
  }
  const provider = (llmConfig.provider || "gemini").toLowerCase();
  if (provider === "gemini") {
    return callGemini(prompt, llmConfig.model || "gemini-1.5-flash", apiKey);
  }
  if (provider === "groq") {
    return callGroq(prompt, llmConfig.model || "llama-3.1-8b-instant", apiKey);
  }
  throw new Error(`Unknown llm.provider "${llmConfig.provider}" — use "gemini" or "groq"`);
}

async function scoreJob(job, config) {
  const prompt = buildPrompt(job, config);
  const raw = await callLLM(prompt, config.llm);
  const parsed = extractFirstJsonObject(raw);

  if (typeof parsed.fitScore !== "number") {
    throw new Error("Model response missing numeric fitScore");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 4: merge into data/jobs.json
// ---------------------------------------------------------------------------

async function main() {
  const config = await loadConfig();
  const existing = await readJsonIfExists(JOBS_PATH, { jobs: [], lastRun: null });
  const existingById = new Map((existing.jobs || []).map((j) => [j.id, j]));

  const postings = await searchAdzuna(config);
  log(`Total unique postings found: ${postings.length}`);

  const fitThreshold = config.scoring?.fitThreshold ?? 6;
  let scoredCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const posting of postings) {
    const id = posting.id;
    const prior = existingById.get(id);

    if (prior && prior.fitScore !== undefined && prior.fitScore !== null) {
      // Already scored in a previous run — keep everything (including any
      // stage the user set), just refresh posting metadata that's safe to
      // refresh (salary, url) without touching stage or cv.
      existingById.set(id, {
        ...prior,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        url: posting.url,
        salaryMin: posting.salaryMin,
        salaryMax: posting.salaryMax,
        salaryDisclosed: posting.salaryDisclosed,
      });
      skippedCount++;
      continue;
    }

    log(`Scoring: ${posting.title} @ ${posting.company}...`);
    try {
      const result = await scoreJob(posting, config);
      const fitScore = result.fitScore;
      const record = {
        id,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        url: posting.url,
        source: posting.source,
        postedAt: posting.postedAt,
        salaryMin: posting.salaryMin,
        salaryMax: posting.salaryMax,
        salaryDisclosed: posting.salaryDisclosed,
        fitScore,
        fitReason: result.reason || "",
        salaryFlag: result.salaryFlag || "not_applicable",
        cv: fitScore >= fitThreshold ? result.cv || null : null,
        stage: prior?.stage || "new_match",
        discoveredAt: prior?.discoveredAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      existingById.set(id, record);
      scoredCount++;
    } catch (err) {
      log(`  ERROR scoring "${posting.title}": ${err.message}`);
      errorCount++;
      // If we've never seen this job before, still record it (unscored) so
      // it isn't silently dropped and can be retried, or at least seen.
      if (!prior) {
        existingById.set(id, {
          id,
          title: posting.title,
          company: posting.company,
          location: posting.location,
          url: posting.url,
          source: posting.source,
          postedAt: posting.postedAt,
          salaryMin: posting.salaryMin,
          salaryMax: posting.salaryMax,
          salaryDisclosed: posting.salaryDisclosed,
          fitScore: null,
          fitReason: `Scoring failed: ${err.message}`,
          salaryFlag: "not_applicable",
          cv: null,
          stage: "new_match",
          discoveredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  const merged = {
    jobs: [...existingById.values()].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1)),
    lastRun: new Date().toISOString(),
    lastRunSummary: {
      postingsFound: postings.length,
      newlyScored: scoredCount,
      alreadyScored: skippedCount,
      errors: errorCount,
    },
  };

  await mkdir(path.dirname(JOBS_PATH), { recursive: true });
  await writeFile(JOBS_PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  log(
    `Done. ${scoredCount} newly scored, ${skippedCount} already known, ${errorCount} errors. ` +
      `Wrote ${merged.jobs.length} total job records to ${JOBS_PATH}`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
