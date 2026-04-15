# CT Collection Threshold Learning Pipeline
# Complete Setup & Usage Protocol (Lay-Person Edition)

---

## TABLE OF CONTENTS

1. [What This Pipeline Does](#1-what-this-pipeline-does)
2. [What You Need Before Starting](#2-what-you-need-before-starting)
3. [Installing Required Software](#3-installing-required-software)
4. [Setting Up the Pipeline](#4-setting-up-the-pipeline)
5. [Starting the Backend Server](#5-starting-the-backend-server)
6. [Starting the Frontend Web Interface](#6-starting-the-frontend-web-interface)
7. [Using the Web Interface](#7-using-the-web-interface)
8. [Understanding Each Page](#8-understanding-each-page)
9. [Working with the Pipeline Programmatically (Advanced)](#9-working-with-the-pipeline-programmatically-advanced)
10. [Stopping Everything](#10-stopping-everything)
11. [Troubleshooting Common Issues](#11-troubleshooting-common-issues)
12. [Glossary of Terms](#12-glossary-of-terms)

---

## 1. WHAT THIS PIPELINE DOES

This pipeline is an automated system for analyzing clinical trial data. It:

- **Retrieves** clinical trial records from ClinicalTrials.gov (the U.S. federal database of clinical studies)
- **Classifies** each drug/intervention by its Mechanism of Action (MOA) — i.e., *how* the drug works at a molecular level — using ChEMBL (a large chemical biology database)
- **Simulates** trial outcomes using real patient genomic data from TCGA (The Cancer Genome Atlas)
- **Learns optimal thresholds** for classifying patients as likely responders or non-responders
- **Visualizes** everything through interactive charts and a web dashboard

You interact with it through a **web browser** — the interface looks like a modern web application with a sidebar navigation, charts, tables, and forms.

---

## 2. WHAT YOU NEED BEFORE STARTING

### Hardware Requirements
- A computer running **Windows 10 or 11** (this guide is Windows-focused; Mac/Linux steps are similar)
- At least **8 GB of RAM** (16 GB recommended)
- At least **2 GB of free disk space**
- An **internet connection** (needed to download software and retrieve trial data)

### Software You Will Install (Step 3 covers each one)
| Software | What It Is | Why You Need It |
|---|---|---|
| Python 3.11+ | A programming language | Runs all the pipeline code |
| Node.js 18+ | A JavaScript runtime | Runs the web interface |
| Git (optional) | Version control tool | Helpful for downloading code |
| A web browser | Chrome, Firefox, or Edge | Where you view the dashboard |
| A terminal/command prompt | Built into your OS | Where you type commands |

---

## 3. INSTALLING REQUIRED SOFTWARE

### Step 3.1: Open a Terminal

**What is a terminal?** A terminal (also called "command prompt" or "PowerShell") is a text-based window where you type commands to control your computer.

**How to open it on Windows:**
1. Press the **Windows key** on your keyboard (the key with the Windows logo, usually bottom-left)
2. Type `cmd` or `PowerShell` or `Terminal`
3. Click on **"Terminal"**, **"Windows Terminal"**, **"Command Prompt"**, or **"PowerShell"** when it appears
4. A dark window with a blinking cursor will open — this is your terminal

> **Tip:** Throughout this guide, when we say "type a command," we mean: type the text shown, then press **Enter** to execute it. Do not type the `$` symbol if shown — that just indicates "this is a command."

### Step 3.2: Check if Python Is Installed

In your terminal, type:
```
python --version
```

- **If you see** something like `Python 3.11.x` or `Python 3.12.x` or higher → Python is already installed. Skip to Step 3.3.
- **If you see** an error like `'python' is not recognized` → You need to install Python.

**To install Python:**
1. Open your web browser (Chrome, Firefox, or Edge)
2. Go to: https://www.python.org/downloads/
3. Click the large yellow **"Download Python 3.x.x"** button
4. Once downloaded, double-click the installer file
5. **CRITICAL:** On the first screen of the installer, check the box that says **"Add Python to PATH"** (near the bottom). This is very important!
6. Click **"Install Now"**
7. Wait for installation to complete, then click "Close"
8. **Close your terminal and open a new one** (so it picks up the new Python)
9. Verify by typing: `python --version`

### Step 3.3: Check if Node.js Is Installed

In your terminal, type:
```
node --version
```

- **If you see** something like `v18.x.x` or `v20.x.x` or higher → Node.js is already installed. Skip to Step 3.4.
- **If you see** an error → You need to install Node.js.

**To install Node.js:**
1. In your web browser, go to: https://nodejs.org/
2. Click the **LTS** (Long Term Support) download button — this is the recommended version
3. Double-click the downloaded installer
4. Click "Next" through all the screens, accepting the defaults
5. Click "Install" and wait for it to finish
6. **Close your terminal and open a new one**
7. Verify by typing: `node --version`

Also verify npm (Node's package manager) is installed:
```
npm --version
```
You should see a version number.

### Step 3.4: Check if Git Is Installed (Optional but Recommended)

```
git --version
```

If not installed, download from https://git-scm.com/downloads and install with default options.

---

## 4. SETTING UP THE PIPELINE

### Step 4.1: Navigate to the Project Folder

The pipeline code is located at:
```
F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
```

In your terminal, navigate to this folder by typing:
```
cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
```

> **What does `cd` mean?** It stands for "change directory" — it tells the terminal to move into a specific folder, like double-clicking a folder in File Explorer.

To verify you're in the right place, type:
```
dir
```
You should see files like `pyproject.toml`, folders like `api`, `analysis`, `frontend`, etc.

### Step 4.2: Create a Python Virtual Environment

A virtual environment is an isolated space for this project's software packages, so they don't interfere with anything else on your computer.

**In your terminal (make sure you're in the project folder):**

```
python -m venv venv
```

This creates a folder called `venv` inside the project. Now **activate** it:

**On Windows (Command Prompt):**
```
venv\Scripts\activate
```

**On Windows (PowerShell):**
```
venv\Scripts\Activate.ps1
```

> **If PowerShell gives a "scripts disabled" error**, run this first:
> ```
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```
> Then try the activate command again.

**How to tell it worked:** You should see `(venv)` appear at the beginning of your terminal prompt, like:
```
(venv) F:\Master_Python_Scripts\CT_Collection_Threshold_Learning>
```

> **IMPORTANT:** Every time you open a new terminal to work with this pipeline, you must activate the virtual environment again using the activate command above. If you don't see `(venv)` at the start of your prompt, the virtual environment is not active.

### Step 4.3: Install Python Dependencies

With the virtual environment active (you see `(venv)` in your prompt), type:

```
pip install -e ".[dev]"
```

**What this does:** It reads the `pyproject.toml` file and installs all the Python packages the pipeline needs (about 30+ packages including FastAPI, SQLAlchemy, NumPy, Plotly, scikit-learn, etc.)

This will take 2-5 minutes depending on your internet speed. You'll see a lot of text scrolling by — that's normal. Wait until you see a message like:
```
Successfully installed ...
```

### Step 4.4: Create the Data Directory

The pipeline needs a place to store its database and cached data:

```
mkdir data
```

If you get a message saying it already exists, that's fine — just continue.

### Step 4.5: Install Frontend Dependencies

Now set up the web interface. Type:

```
cd frontend
npm install
```

**What this does:** It downloads all the JavaScript packages needed for the web interface (React, Plotly.js, Axios, etc.)

This will take 1-3 minutes. Wait until it finishes. Then go back to the main project folder:

```
cd ..
```

### Step 4.6: Verify the Installation

Run the test suite to make sure everything is installed correctly:

```
python -m pytest --tb=short -q
```

**What this does:** It runs 173 automated tests that check every part of the pipeline.

You should see output ending with something like:
```
173 passed in 24.16s
```

If all tests pass, your installation is complete!

> **If some tests fail:** Make sure your virtual environment is active (`(venv)` in prompt) and that `pip install -e ".[dev]"` completed without errors. Try running the install command again.

---

## 5. STARTING THE BACKEND SERVER

The pipeline has two parts that need to run simultaneously:
1. **Backend server** (Python/FastAPI) — processes data, runs analyses, serves the API
2. **Frontend server** (React/Vite) — serves the web interface you see in your browser

You will need **two separate terminal windows** for this.

### Step 5.1: Open Terminal Window #1 (Backend)

1. Open a new terminal window (see Step 3.1)
2. Navigate to the project folder:
   ```
   cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
   ```
3. Activate the virtual environment:
   ```
   venv\Scripts\activate
   ```
4. Start the backend server:
   ```
   uvicorn api.main:app --reload --port 8000
   ```

**What this does:** It starts the API server on your computer at port 8000.

You should see output like:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [xxxxx]
INFO:     Started server process [xxxxx]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

> **Leave this terminal window open and running!** It must stay running the entire time you use the pipeline. If you close it, the web interface will stop working.

### Step 5.2: Verify the Backend Is Running

Open your web browser and go to:
```
http://localhost:8000
```

You should see a JSON response like:
```json
{"message": "CT Pipeline API", "version": "0.1.0"}
```

You can also check the health endpoint:
```
http://localhost:8000/health
```

Which should show:
```json
{"status": "ok"}
```

If you see these responses, the backend is running correctly.

> **Optional:** Visit http://localhost:8000/docs to see the auto-generated API documentation with all available endpoints. This is an interactive page where you can test API calls directly.

---

## 6. STARTING THE FRONTEND WEB INTERFACE

### Step 6.1: Open Terminal Window #2 (Frontend)

1. Open a **second, new** terminal window (you now have two open)
2. Navigate to the frontend folder:
   ```
   cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning\frontend
   ```
3. Start the development server:
   ```
   npm run dev
   ```

**What this does:** It starts the web interface development server.

You should see output like:
```
  VITE v8.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

> **Leave this terminal window open too!** You now have two terminals running — one for the backend, one for the frontend.

### Step 6.2: Open the Web Interface

Open your web browser and go to:
```
http://localhost:5173
```

You should see the CT Pipeline dashboard with a dark sidebar on the left containing navigation links (Dashboard, Trial Explorer, Conditions, etc.) and a main content area on the right.

**Congratulations — the pipeline is running!**

---

## 7. USING THE WEB INTERFACE

### Layout Overview

The web interface has:
- **Left sidebar** (dark blue): Navigation menu with 10 pages
- **Main content area** (light gray): The active page content

Click any item in the sidebar to navigate to that page.

### Summary of Available Pages

| Page | What It Does |
|---|---|
| **Dashboard** | High-level summary: total trials, enrollment, conditions, plus key charts |
| **Trial Explorer** | Browse, search, and filter individual clinical trials |
| **Conditions** | View all disease conditions in the database; expand disease terms using MeSH |
| **MOA Overview** | See how drugs are classified by Mechanism of Action |
| **Analysis** | Detailed charts: trials per condition, phase distribution, status breakdown |
| **Filtering** | Advanced multi-field filtering (phase, status, sponsor, condition, MOA, etc.) |
| **Simulation** | Run in-silico trial simulations using TCGA patient data |
| **Genomics** | View gene expression analysis and DCNA scoring results |
| **Threshold** | Learn optimal classification thresholds (Youden, cost-based, percentile) |
| **Export** | Download trial data as CSV or JSON files |

---

## 8. UNDERSTANDING EACH PAGE

### 8.1 Dashboard

**What you see:** Five summary cards (Total Trials, Total Enrollment, Mean Enrollment, Conditions, Interventions) plus two charts.

**How to use it:** This is your overview page. The numbers update automatically as you load more data into the pipeline. The charts show trials per condition and phase distribution.

> **Note:** If the database is empty (first run), all numbers will be zero. You need to load data first — see Section 9 for how to do this programmatically.

---

### 8.2 Trial Explorer

**What you see:** A search bar, a status dropdown, and a list of trial cards.

**How to use it:**
1. **Search by condition:** Type a disease name (e.g., "Glioblastoma") in the text box and press Enter
2. **Filter by status:** Use the dropdown to select a trial status (RECRUITING, COMPLETED, etc.)
3. **Browse results:** Each card shows the NCT ID (trial identifier), status, phase, title, conditions, enrollment count, and sponsor
4. **View details:** Click any NCT ID (e.g., "NCT00000001") to see the full trial record with summary, interventions, eligibility criteria, outcomes, and arms
5. **Navigate pages:** Use the Previous/Next buttons at the bottom if there are more than 20 results

---

### 8.3 Conditions

**What you see:** A "Disease Term Expansion" box at the top, and a table of all conditions below.

**How to use it:**

**Term Expansion (top section):**
1. Type a disease abbreviation or name in the text box (e.g., "GBM", "NSCLC", "Breast Cancer")
2. Click **"Expand"** or press Enter
3. The pipeline will query the MeSH medical thesaurus and show all expanded/related terms
4. For example, "GBM" expands to: Glioblastoma, Glioblastoma Multiforme, Giant Cell Glioblastoma, Gliosarcoma, etc.

**Condition Table (bottom section):**
- Lists every disease condition in the database along with how many trials are associated with it
- Sorted by name

---

### 8.4 MOA Overview

**What you see:** A bar chart showing Mechanism of Action categories, and a data table below.

**How to use it:** This page shows how the drugs in your database are classified by their mechanism:
- The chart displays each MOA category (e.g., Kinase Inhibitor, Checkpoint Inhibitor, Alkylating Agent) with the number of interventions and trials
- The table shows exact counts for each category
- This helps you understand the therapeutic landscape of the trials in your database

**MOA categories include:** Kinase Inhibitor, Checkpoint Inhibitor, Angiogenesis Inhibitor, Alkylating Agent, Antimetabolite, Hormone Therapy, Monoclonal Antibody, and about 15 others.

---

### 8.5 Analysis

**What you see:** Two charts at the top (Trials per Condition, Phase Distribution) and two tables below (Phase Breakdown, Status Breakdown).

**How to use it:** This is a more detailed analytical view:
- **Trials per Condition chart:** Horizontal bar chart showing which diseases have the most trials
- **Phase Distribution chart:** Shows how trials are distributed across Phase 1, 2, 3, and 4
- **Phase Breakdown table:** Exact numbers for each phase
- **Status Breakdown table:** Shows how many trials are Recruiting, Completed, Terminated, etc.

---

### 8.6 Filtering

**What you see:** A filter panel with checkboxes, and a results table below.

**How to use it:**
1. **Select filters:** Check boxes in any combination of:
   - **Phase:** Phase 1, Phase 2, Phase 3, Phase 4, Not Applicable
   - **Status:** RECRUITING, COMPLETED, TERMINATED, etc.
   - **Study Type:** INTERVENTIONAL, OBSERVATIONAL
   - **Condition:** Specific diseases
   - **MOA Category:** Mechanism of Action categories
   - **Sponsor:** Specific organizations
2. Click **"Apply Filters"** to see matching trials
3. Click **"Clear"** to reset all filters
4. The results table shows NCT ID, Title, Status, Phase, and Enrollment for all matching trials

---

### 8.7 Simulation

**What you see:** A form with three input fields and a "Run Simulation" button.

**What this does:** It runs a virtual ("in-silico") clinical trial using real patient data from TCGA (The Cancer Genome Atlas). Instead of enrolling actual patients, it takes genomic profiles of cancer patients and simulates how they would respond to the trial's treatment.

**How to use it:**
1. **Trial NCT ID:** Enter the NCT ID of a trial from your database (e.g., "NCT00000001")
2. **Response Rate:** The expected drug response rate as a decimal (default 0.15 = 15%). This is the probability that a given patient will respond to the treatment.
3. **Max Cohort Size:** Maximum number of TCGA patients to include in the simulation (default 500)
4. Click **"Run Simulation"**
5. Results show: Total Cohort, Eligible patients (matching trial criteria), Responders, Response Rate, and Mean Response Magnitude

> **Note:** This requires TCGA data to be available (either downloaded locally or accessible via the GDC API). If no TCGA data is loaded, the simulation will return an error.

---

### 8.8 Genomics

**What you see:** Information cards describing the genomic analysis pipeline and the steps involved.

**What this shows:**
- **DCNA Score Distribution:** How Drug-Constrained Network Activity scores are distributed across patient samples (violin plots appear when genomic data is processed)
- **Expression Heatmap:** Target gene expression patterns across TCGA samples
- **Pipeline Steps:** A numbered list explaining the genomic analysis workflow:
  1. Fetch TCGA data
  2. Match cases to eligibility criteria
  3. Extract MOA-specific gene sets
  4. Compute DCNA scores via ssGSEA
  5. Classify responders
  6. Evaluate with ROC analysis

---

### 8.9 Threshold

**What you see:** A form with method selection, parameters, and a "Learn Threshold" button.

**What this does:** It finds the optimal threshold value for classifying patients as responders vs. non-responders, based on their DCNA scores.

**How to use it:**
1. **Method:** Choose from:
   - **Youden's J** (recommended): Maximizes the sum of sensitivity and specificity
   - **Cost-Based:** Minimizes the total cost of misclassifications (you set the cost ratio)
   - **Percentile:** Sets the threshold at a specific percentile of the score distribution
2. **Cost FN Ratio:** Only relevant for Cost-Based method. A ratio of 2.0 means a false negative (missing a responder) costs twice as much as a false positive. Default is 1.0 (equal cost).
3. **Percentile:** Only relevant for Percentile method. 0.5 = median.
4. Click **"Learn Threshold"**
5. Results show: the optimal Threshold value, Sensitivity (true positive rate), Specificity (true negative rate), AUC (area under the ROC curve), and Youden's J statistic

---

### 8.10 Export

**What you see:** Two download buttons (CSV and JSON) and a format comparison table.

**How to use it:**
1. Click **"Download CSV"** to get a comma-separated file (opens in Excel, R, or any spreadsheet program)
2. Click **"Download JSON"** to get a structured JSON file (useful for programming or API integration)

**When to use which format:**
- **CSV:** Best for Excel, Google Sheets, R, pandas, or any statistical analysis tool
- **JSON:** Best for programmatic access, web applications, or when you need nested/structured data

---

## 9. WORKING WITH THE PIPELINE PROGRAMMATICALLY (Advanced)

If you want to load data or run analyses beyond what the web interface offers, you can use Python directly.

### Step 9.1: Open a Third Terminal (Python)

1. Open a new (third) terminal window
2. Navigate to the project:
   ```
   cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
   ```
3. Activate the virtual environment:
   ```
   venv\Scripts\activate
   ```
4. Start a Python interactive session:
   ```
   python
   ```
   You should see a `>>>` prompt.

### Step 9.2: Load Trial Data for a Disease

```python
import asyncio
from connectors.clinicaltrials import ClinicalTrialsConnector
from connectors.disease_mapper import DiseaseMapper
from database.engine import create_db_engine, init_db, get_session_factory
from database.etl import load_trials
from config.schema import load_config

# Load configuration
config = load_config()

# Initialize database
engine = create_db_engine(config.database)
init_db(engine)
session = get_session_factory(engine)()

# Expand disease terms
mapper = DiseaseMapper()
terms = mapper.expand_sync("GBM")
print(f"Search terms: {terms}")

# Fetch trials from ClinicalTrials.gov
connector = ClinicalTrialsConnector()
trials = asyncio.run(connector.get_all_trials_for_disease("GBM"))
print(f"Found {len(trials)} trials")

# Store in database
load_trials(session, trials)
print("Trials loaded into database!")

session.close()
```

> After loading data, refresh the web interface in your browser — the Dashboard and other pages will now show the loaded data.

### Step 9.3: Run MOA Classification

```python
from moa_classification.classifier import MOAClassifier
from database.engine import create_db_engine, get_session_factory
from config.schema import load_config

config = load_config()
engine = create_db_engine(config.database)
session = get_session_factory(engine)()

classifier = MOAClassifier(session=session)
results = classifier.classify_all()
print(f"Classified {len(results)} interventions")

session.close()
```

### Step 9.4: Exit Python

Type `exit()` and press Enter to return to the terminal prompt.

---

## 10. STOPPING EVERYTHING

When you're done using the pipeline, stop each component:

### Stop the Frontend (Terminal #2)
1. Click on the terminal window running the frontend
2. Press **Ctrl + C** (hold Control and press C)
3. The server will stop

### Stop the Backend (Terminal #1)
1. Click on the terminal window running the backend
2. Press **Ctrl + C**
3. The server will stop

### Deactivate the Virtual Environment (any terminal)
```
deactivate
```
This removes the `(venv)` prefix from your prompt.

### Close Terminal Windows
Simply close each terminal window using the X button, or type `exit` and press Enter.

> **Your data is saved!** The SQLite database at `data/ct_pipeline.db` persists between sessions. Next time you start the pipeline, all previously loaded data will still be there.

---

## 11. TROUBLESHOOTING COMMON ISSUES

### "python is not recognized as a command"
- Python is not installed or not added to PATH
- Reinstall Python and make sure to check **"Add Python to PATH"** during installation
- Close and reopen your terminal after installing

### "npm is not recognized as a command"
- Node.js is not installed
- Install Node.js from https://nodejs.org/ and restart your terminal

### "'venv\Scripts\activate' is not recognized"
- You're not in the project directory. Run: `cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning`
- Or the venv doesn't exist yet. Run: `python -m venv venv`

### PowerShell says "running scripts is disabled on this system"
Run this once in PowerShell:
```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
Then try the activate command again.

### "ModuleNotFoundError: No module named 'xxx'"
- Your virtual environment is not activated (no `(venv)` in prompt)
- Activate it: `venv\Scripts\activate`
- Or packages weren't installed. Run: `pip install -e ".[dev]"`

### Backend shows "Address already in use"
Another program is using port 8000. Either:
- Close that program, or
- Use a different port: `uvicorn api.main:app --reload --port 8001` (then also update `VITE_API_URL` in the frontend)

### Frontend shows "Failed to load" or empty charts
- Make sure the backend is running in Terminal #1
- Make sure you've loaded data into the database (see Section 9.2)
- Check the backend terminal for error messages

### "sqlite3.OperationalError: no such table"
The database tables haven't been created. The backend creates them on startup, so make sure you've started the backend at least once.

### Web page shows a blank white screen
- Open your browser's developer tools (press F12)
- Check the Console tab for error messages
- Usually means the frontend has a JavaScript error — try running `npm run build` in the frontend folder to check for compile errors

### All tests fail
- Make sure the virtual environment is active
- Try reinstalling: `pip install -e ".[dev]"`
- Check your Python version: `python --version` (must be 3.11 or higher)

---

## 12. GLOSSARY OF TERMS

| Term | Meaning |
|---|---|
| **API** | Application Programming Interface — a way for software programs to communicate with each other. The backend API is how the frontend gets data. |
| **Backend** | The "behind the scenes" server that processes data, runs analyses, and serves results. You don't see it directly — it runs in a terminal window. |
| **ChEMBL** | A large open-access database of bioactive molecules with drug-like properties, maintained by the European Bioinformatics Institute. |
| **CLI** | Command Line Interface — interacting with a computer by typing text commands in a terminal. |
| **ClinicalTrials.gov** | The U.S. federal database of clinical studies, maintained by the National Library of Medicine. |
| **CSV** | Comma-Separated Values — a simple file format for tabular data that can be opened in Excel. |
| **DCNA** | Drug-Constrained Network Activity — a score measuring how active a drug's target genes are in a patient's tumor. Higher scores suggest the drug's targets are highly expressed. |
| **FastAPI** | The Python framework used to build the backend API server. |
| **Frontend** | The visual web interface you see in your browser (the charts, tables, buttons, etc.). |
| **GDC** | Genomic Data Commons — the NIH data portal for cancer genomic datasets including TCGA. |
| **Gene Expression** | A measurement of how active (turned on) a specific gene is in a tissue sample. |
| **In-Silico** | "In silicon" — a computational simulation, as opposed to in-vivo (in a living organism) or in-vitro (in a test tube). |
| **JSON** | JavaScript Object Notation — a structured data format commonly used in web APIs. |
| **MeSH** | Medical Subject Headings — a controlled vocabulary used by the National Library of Medicine to index biomedical literature. |
| **MOA** | Mechanism of Action — how a drug produces its therapeutic effect at the molecular level. |
| **MCP** | Model Context Protocol — a standardized way for AI models to connect to external data sources. |
| **NCT ID** | National Clinical Trial Identifier — a unique code assigned to each clinical study on ClinicalTrials.gov (e.g., NCT00000001). |
| **Node.js** | A JavaScript runtime that allows running JavaScript outside a web browser. Used to build and serve the frontend. |
| **npm** | Node Package Manager — installs JavaScript libraries/packages. |
| **pip** | Python's package manager — installs Python libraries/packages. |
| **Plotly** | An interactive charting library used to create the pipeline's visualizations. |
| **Python** | A programming language used for the pipeline's backend, analysis, and data processing. |
| **React** | A JavaScript framework used to build the frontend web interface. |
| **ROC Curve** | Receiver Operating Characteristic curve — a plot showing a classifier's performance at different threshold settings. |
| **SQLite** | A lightweight database engine that stores data in a single file on your computer. |
| **ssGSEA** | Single-sample Gene Set Enrichment Analysis — a method for scoring how enriched a set of genes is in a single sample. |
| **TCGA** | The Cancer Genome Atlas — a landmark cancer genomics program that molecularly characterized over 20,000 primary cancers. |
| **Terminal** | A text-based window for typing commands (also called command prompt, console, or shell). |
| **TypeScript** | A typed version of JavaScript used to build the frontend code. |
| **Uvicorn** | The ASGI server that runs the FastAPI backend application. |
| **Virtual Environment (venv)** | An isolated Python installation for a specific project, keeping its packages separate from your system Python. |
| **Vite** | A fast build tool and development server for the frontend web interface. |
| **Youden's J** | A statistic that summarizes the performance of a diagnostic test: J = Sensitivity + Specificity - 1. Maximizing J gives the optimal threshold. |

---

## QUICK REFERENCE CARD

```
========================================================
  CT Pipeline — Quick Start Cheat Sheet
========================================================

  SETUP (one time):
    cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
    python -m venv venv
    venv\Scripts\activate
    pip install -e ".[dev]"
    mkdir data
    cd frontend && npm install && cd ..

  START (every time):
    Terminal 1 (Backend):
      cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning
      venv\Scripts\activate
      uvicorn api.main:app --reload --port 8000

    Terminal 2 (Frontend):
      cd F:\Master_Python_Scripts\CT_Collection_Threshold_Learning\frontend
      npm run dev

    Browser:
      Open http://localhost:5173

  STOP:
    Press Ctrl+C in each terminal window
    'deactivate' in venv setup terminal window to close venv

  RUN TESTS:
    python -m pytest --tb=short -q

========================================================
```
