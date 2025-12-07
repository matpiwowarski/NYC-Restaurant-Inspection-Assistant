# Challenge B: NYC Restaurant Inspection Assistant

## Overview

A tool designed to flag discrepancies between NYC restaurant inspection violation descriptions and the actual Health Code.
The system parses inspection data (CSV) and the Health Code (PDF), stores them in MongoDB, and uses vector search/semantic similarity to verify if cited violations actually exist in the current code.

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
    - `health_code.pdf`: The official NYC Health Code document.
    - `inspections.csv`: The dataset of restaurant inspections.

2.  **Run Ingestion Command**

    This command parses the PDF to extract health code articles and their embeddings, and ingests unique violation descriptions from the CSV.

    ```bash
    pnpm run load-data
    ```

3.  **Verify Data**
    You can use [MongoDB Compass](https://www.mongodb.com/products/tools/compass) to connect to `mongodb://localhost:27017/nyc_inspector` and check that the `HealthCode` and `Violation` collections are populated.

## Running the Application

Once data is loaded, you can run the main application.

```bash
# development mode
pnpm run start

# watch mode
pnpm run start:dev
```

## Project Structure

- `src/data-ingestion/`: Core logic for parsing and loading data.
  - `health-code-ingestion.service.ts`: Handles PDF parsing and embedding generation.
  - `violation-ingestion.service.ts`: Handles CSV processing for inspection violations.
  - `feature-extraction.service.ts`: Utility for generating text embeddings (using Transformers.js).
- `src/command.ts`: Entry point for CLI commands (like `load-data`).
- `prisma/`: Database schema and configuration.
- `data/`: Local directory for input files (`health_code.pdf`, `inspections.csv`).
