# NYC Restaurant Inspection Assistant

## Overview
A tool designed to flag discrepancies between NYC restaurant inspection violation descriptions and the actual Health Code.
The system parses inspection data (CSV) and the Health Code (PDF), stores them in MongoDB, and uses vector search/semantic similarity to verify if cited violations actually exist in the current code.

## Implementation Plan
1.  **Infrastructure**: 
    - MongoDB with Replica Set (via Docker)
    - NestJS application
    - Prisma ORM (MongoDB provider)
2.  **Data Ingestion**:
    - Parsing `data/health_code.pdf` into articles with embeddings.
    - Parsing `data/inspections.csv` for unique violation descriptions.
3.  **Analysis Engine**:
    - Comparing violation descriptions against Health Code articles using embeddings.
    - Flagging mismatches.

## Prerequisites
- Node.js (v20+)
- Docker & Docker Compose
- pnpm

## Setup

1.  **Start Database**
    ```bash
    docker compose up -d
    ```

2.  **Install Dependencies**
    ```bash
    pnpm install
    ```

3.  **Setup Environment**
    Ensure `.env` contains your MongoDB connection string (default in docker-compose is `mongodb://localhost:27017/nyc_inspector?replicaSet=rs0`).

4.  **Run Application**
    ```bash
    # development
    pnpm run start

    # watch mode
    pnpm run start:dev
    ```

## Project Structure
- `src/`: NestJS source code
- `data/`: Place your `health_code.pdf` and `inspections.csv` here.
- `prisma/`: Database schema and configuration.
