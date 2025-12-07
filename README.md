# Challenge B: NYC Restaurant Inspection Assistant

## Problem & Approach

### Why this scope?

I prioritized **Database Design** and **Advanced Data Ingestion** because I believe a solid data structure is the decisive factor for the entire system's performance and accuracy. I also viewed this as an excellent challenge to practice transforming "messy" real-world inputs (massive CSV and an unstructured, inconsistent PDF) into clean, actionable data.

**Semantic Search**:
I chose **Semantic Search** for detecting discrepancies because of the significant vocabulary mismatch. Inspectors use informal descriptions (e.g. "mice present") that often do not textually overlap with the formal legal text (e.g. "conditions conducive to pests"). Semantic search captures the meaning rather than just matching characters, which is essential for this problem.

**Forward-Looking Schema & Chunking Strategy**:
The database is designed to support the core analysis logic immediately. I chose to chunk the Health Code into **individual sentences** because violation descriptions are typically single sentences. Comparing a short description against an entire multi-page legal article would dilute the semantic meaning and yield poor results. 1-to-1 sentence comparison ensures high-precision semantic matching.

**MongoDB**:
Selected for its flexibility in handling the varied and sometimes inconsistent structure of the PDF content (nested sections, chunks) and its native support for Vector Search (Atlas), simplifying the stack.

My focus was on solving the complex data engineering challenges:

- **Noise Reduction**: Distilled a massive inspection CSV file down to just ~231 unique, meaningful violation descriptions.
- **Resilient Parsing**: Built a custom parser for the `Health Code` PDF that handles nested legal structures, inconsistent formatting, human errors, etc. to ensure clean, semantic chunks for embedding.

### Evaluation Strategy

To ensure data integrity and parsing accuracy, I utilized **MongoDB Compass** and external validation:

- **Quantitative Verification**:
  - **Health Code**: Confirmed 33 Article records were created, consistent with the PDF structure.
  - **Violations**: Verified 231 unique violation records were created. This matches the count of unique `VIOLATION CODE` + `VIOLATION DESCRIPTION` pairs found in the NYC OpenData online visualizer.
- **Visual Inspection**: Manually compared generated database records against the original PDF text and CSV rows to verify content fidelity.
- **Aggregation Analysis**: Used filtering and aggregation queries to validate extraction counts and detect anomalies.

## Database Schema

![Database Schema](docs/schema.png)

## Roadmap & Status

### ✅ Completed

- [x] **Database Schema**: Designed schema to store PDF/CSV data and support vector-based semantic search. The structure also enables understanding the context of discrepancies and easily presenting it to the user.
- [x] **Data Ingestion**: Parsing `health_code.pdf` and `inspections.csv`.
- [x] **Infrastructure**: MongoDB Replica Set (Docker), Prisma setup.
- [x] **Embeddings**: Generating vector embeddings for Health Code text chunks and Violations.

### 🚧 To Do

- [ ] **Vector Search**: Implement MongoDB Atlas Vector Search compatibility.
- [ ] **Analysis Engine**: Logic to find violations with lowest similarity scores against the Health Code.
- [ ] **Persistence**: Store analysis results (flagged violations) in the database.
- [ ] **API**: Endpoints to retrieve flagged violations.
- [ ] **Automation**: Triggers to re-calculate discrepancies when data is updated.

### 🔮 Future Improvements

- [ ] **Performance**: Implement necessary indexes along with performance tests.
- [ ] **Resilience**: Robust validation for corrupt/incomplete PDF or CSV files.
- [ ] **Testing**: Comprehensive unit tests for `health-code-parsing.service.ts`.
- [ ] **Optimization**: Stream-based ingestion to reduce RAM usage (process in chunks).

## Prerequisites

- **Node.js** (v20+)
- **Docker & Docker Compose** (for MongoDB Replica Set)
- **pnpm** (Package Manager)

## Setup

1.  **Start Database**

    Starts a MongoDB instance configured as a Replica Set (required for Prisma MongoDB provider).

    ```bash
    docker compose up -d
    ```

2.  **Install Dependencies**

    ```bash
    pnpm install
    ```

3.  **Generate Database Client**

    Run this after installing dependencies or whenever `prisma/schema.prisma` changes.

    ```bash
    npx prisma generate
    ```

4.  **Setup Environment**

    Ensure `.env` contains your MongoDB connection string.
    Example in `.env.dist`:

    ```bash
    DATABASE_URL="mongodb://localhost:27017/nyc_inspector?replicaSet=rs0"
    ```

## Data Ingestion

Before analyzing violations, you must populate the database with the Health Code and Inspection data.

1.  **Prepare Data Files**
    Place the following files in the `data/` directory (create it if it doesn't exist):
    - `health_code.pdf`: [ARTICLE 81 FOOD PREPARATION AND FOOD ESTABLISHMENTS](https://www.nyc.gov/assets/doh/downloads/pdf/about/healthcode/health-code-article81.pdf)
    - `inspections.csv`: [DOHMH New York City Restaurant Inspection Results](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j/about_data)

2.  **Run Ingestion Command**

    This command parses the PDF to extract health code articles and their embeddings, and ingests unique violation descriptions from the CSV.

    ```bash
    pnpm run load-data
    ```

3.  **Verify Data**
    You can use [MongoDB Compass](https://www.mongodb.com/products/tools/compass) to connect to `mongodb://localhost:27017/nyc_inspector` and check that the `HealthCode` and `Violation` collections are populated.

## Project Structure

- `src/data-ingestion/`: Core logic for parsing and loading data.
  - `health-code-ingestion.service.ts`: Handles PDF parsing orchestration and embedding generation.
  - `health-code-parsing.service.ts`: Specialized logic for parsing Health Code text structure.
  - `violation-ingestion.service.ts`: Handles CSV processing for inspection violations.
  - `feature-extraction.service.ts`: Utility for generating text embeddings (using Transformers.js).
- `src/command.ts`: Entry point for CLI commands (like `load-data`).
- `prisma/`: Database schema and configuration.
- `data/`: Local directory for input files (`health_code.pdf`, `inspections.csv`).
