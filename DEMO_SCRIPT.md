# Sygnomics ORACLE — 10-Minute Demo Script

**Audience:** Mixed technical / lay
**Goal:** Walk through the full ORACLE pipeline, from disease entry to in-silico therapy simulation, in roughly ten minutes.
**Tagline to open with:** "ORACLE — Oncology Response & Cohort Learning Engine — turns the public clinical-trial record into an evidence base we can actually compute on."

---

## 0. Welcome page (0:00 – 0:45)

Land on `/` (Welcome).

Talking points:
- "This is Sygnomics ORACLE. Behind it is a database of ~1,895 clinical trials in glioblastoma — every NCT-listed trial we could find plus 138 EU CTIS trials — re-ingested with our own parsers."
- Point at the seven-step list: **Acquires, Classifies, Extracts, Scores, Learns, Simulates, Exports.**
- "We'll do a tour that touches each of those, ending in a quantitative outcome simulation."

> Click **Disease Search** in the sidebar.

---

## 1. Disease Search (0:45 – 1:45)

Type **glioblastoma** and click **Expand**.

Talking points:
- "MeSH gives us synonyms — glioblastoma multiforme, GBM, grade IV astrocytoma, etc. The table shows how many trials in our database match *each* expanded term, plus the **unique union** at the bottom."
- "The union number is what matters: it deduplicates trials that match more than one synonym. For glioblastoma it's about 1,176 unique trials."
- "The reason it's lower than the 1,895 in Trial Explorer is that Trial Explorer also contains adjacent CNS-tumor trials we ingested for cross-referencing. Disease Search only counts trials whose listed conditions actually map to a glioblastoma synonym."

> Click the green **View matching trials in Trial Explorer** button.

---

## 2. Trial Explorer (1:45 – 3:15)

ORACLE has navigated to `/trials` with the disease filter pre-applied.

Talking points:
- "Disease Search just deep-linked us into a pre-filtered Trial Explorer view. We can keep narrowing — phase, status, intervention type, sponsor, country."
- Sort by **enrollment** descending. "These are the largest GBM trials in the database."
- Click into **NCT00977431** (the BIBW 2992 / afatinib + radiotherapy trial).

---

## 3. Trial Detail — Eligibility & Per-Arm Criteria (3:15 – 4:45)

You're now on the trial-detail page for NCT00977431.

Talking points:
- "Eligibility section. Notice the **TCGA-GBM Matchable Criteria** chip block — these are biomarker and disease-state criteria that ORACLE pulled out of free-text eligibility and the trial summary, and that we can match against the TCGA-GBM cohort."
- For NCT00977431 you should see **Newly diagnosed** and **MGMT status known** at the trial level.
- "Below that, in the Arms section, each arm has its own molecular criteria callout. ORACLE figured out from the trial summary that **Regimen U** is for MGMT-unmethylated patients and **Regimen M** is for MGMT-methylated patients — even though the per-arm description text doesn't say that. We extracted it from the prose summary and used a per-arm assignment heuristic."
- This is the headline differentiation: "Most clinical-trial parsers stop at the eligibility block. ORACLE also reads the brief summary and reconciles arm-specific stratifications."

Scroll to the **Outcome Results** table.

Talking points:
- "When a trial reports response by category — complete response, partial response, stable disease, progression — ORACLE adds a derived **Combined** row that sums CR + PR over the analyzed N. The blue row is clearly marked as derived and not from the source data."
- "Stable disease and progression rows are dimmed and excluded from the response-rate calculations."
- "These combined values flow downstream into every threshold analysis and simulation we run."

---

## 4. WHO Classification & MOA Overview (4:45 – 5:45)

Navigate to **WHO Classification**.

Talking points:
- "ORACLE applies WHO 2021 CNS tumor classification to every trial, using extracted molecular criteria — IDH, 1p/19q, MGMT, CDKN2A, H3K27M."
- Show the distribution chart. "About 85% of our cohort maps cleanly to GBM, IDH-wildtype."

Navigate to **MOA Overview**.

Talking points:
- "Trials are also tagged by mechanism of action — alkylators, anti-angiogenics, EGFR inhibitors, checkpoint inhibitors, vaccines, CAR-T, and so on."
- "Pick any MOA card to see how many trials, what the historical response rates look like, and which arms ORACLE will let you simulate against."

---

## 5. Analysis Dashboard (5:45 – 6:30)

Navigate to **Analysis Dashboard**.

Talking points:
- "This is the cohort-level read across the whole database — phase mix, sponsor types, completion timelines, biomarker prevalence, geographic spread."
- "It's the page to send to leadership when you want one-screen situational awareness."

---

## 6. Trial Filtering → TCGA Cohort (6:30 – 7:30)

Navigate to **Trial Filtering**, build a quick query (e.g., GBM + recurrent + checkpoint inhibitor), apply.

Then jump to **TCGA Cohort**.

Talking points:
- "TCGA-GBM is 596 patients with full multi-omic data. ORACLE scores each one using **Drug-Constrained Network Activity** — a graph-based score that asks how much of a drug's downstream pathway is actually active in that patient's tumor."
- Demo the DCNA tab with a familiar drug (e.g., **temozolomide** or **bevacizumab**).
- "Switch to the Patient tab to drill into a single TCGA case — molecular subtype, expression, DCNA scores, and which trials they would have been eligible for."

---

## 7. Threshold Analysis (Simulation page) (7:30 – 8:45)

Navigate to **Simulation**.

Talking points:
- "Pick an MOA — let's use temozolomide. ORACLE pulls every TCGA-GBM patient, computes their DCNA score against that MOA, and asks: **at what DCNA cutoff does the response rate observed in real trials best separate responders from non-responders?**"
- "The threshold is learned from the historical category-level response rates we extracted in step 3 — including the combined CR+PR rows."
- Point out the ROC curve and the learned threshold marker. "Above this line, patients are predicted responders. Below it, predicted non-responders."
- "This is the bridge between published trial data and patient-level predictions. Every threshold ORACLE learns is reproducible — we can show the exact source rows."

---

## 8. Novel Therapy Simulation (8:45 – 9:45)

Navigate to **Novel Therapy Simulation**.

Talking points:
- "Now flip it. Suppose we have a brand-new molecule with a hypothesized target — say, an EGFRvIII degrader. We don't have a trial yet."
- Enter target gene(s), molecular constraints, and an estimated response rate (or let ORACLE seed from a comparable trial).
- "ORACLE applies the same DCNA framework against TCGA-GBM, screens the cohort against the eligibility criteria you specify, and runs an in-silico trial: enrollment, predicted response rate, projected survival curves."
- "Because the seeded response rate uses the **same combined CR+PR logic** as Threshold Analysis, the two pages are consistent end-to-end."

---

## 9. Export (9:45 – 10:00)

Navigate to **Export**.

Closing line:
- "Everything you just saw — filtered trial cohorts, per-arm molecular criteria, threshold-learning runs, simulation outputs — exports to CSV / JSON for downstream analysis, regulatory packages, or feeding into our decision-support models."
- "That's ORACLE: **acquire, classify, extract, score, learn, simulate, export** — in ten minutes."

---

## Cheat sheet for Q&A

| Question | Short answer |
|---|---|
| How many trials? | 1,895 total: 1,757 from ClinicalTrials.gov + 138 EU CTIS. |
| How recent? | Re-ingested in full as of the current build; refreshable on demand. |
| How is "MGMT methylated" detected? | Regex over eligibility text **and** the trial brief summary, with a per-arm assignment pass that links arm-specific stratifications to the right regimen and a trial-level filter that hides arm-specific markers from the trial-wide list. |
| What's the "Combined" row in outcomes? | A derived CR+PR / N rate that ORACLE computes when a trial reports response by category. Clearly labeled as derived; flows into all simulations. |
| What's TCGA-matchable? | Any biomarker, molecular state, or disease-state criterion (e.g., newly diagnosed, recurrent) that has a corresponding measurement in the TCGA-GBM cohort. |
| What's DCNA? | Drug-Constrained Network Activity — our graph-based per-patient score for how active a drug's pathway is in a tumor. |
| Where does the threshold come from? | Learned from historical category-level response rates (including the combined CR+PR derived rows), via Youden's J on a per-MOA ROC. |

---

## Suggested click path (no narration)

1. `/` Welcome
2. `/conditions` → enter **glioblastoma** → Expand → **View matching trials**
3. `/trials` → sort by enrollment → **NCT00977431**
4. Trial detail → Eligibility (TCGA-GBM Matchable Criteria) → Arms (per-arm MGMT split) → Outcome Results (Combined row)
5. `/who` → distribution
6. `/moa` → MOA card
7. `/dashboard`
8. `/filtering` → quick query
9. `/tcga` → DCNA tab → Patient tab
10. `/simulation` → temozolomide → threshold + ROC
11. `/novel-therapy` → seed from trial → run
12. `/export`
