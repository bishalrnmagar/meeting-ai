#!/usr/bin/env bash
set -euo pipefail

echo "=== Starting Meeting AI Assistant (Dev) ==="

# Start infra
echo "[1/3] Starting PostgreSQL + Redis..."
docker-compose -f docker-compose.dev.yml up -d

echo "[2/3] Starting Python API..."
cd backend/python-api
uv sync
uv run uvicorn app.main:app --reload --port 8000 &
PYTHON_PID=$!
cd ../..

echo "[3/3] Starting Node Bot Orchestrator..."
cd backend/node-bot-orchestrator
yarn install --silent
yarn dev &
NODE_PID=$!
cd ../..

echo ""
echo "=== Services Running ==="
echo "  Python API:        http://localhost:8000"
echo "  Node Orchestrator: http://localhost:3001"
echo "  PostgreSQL:        localhost:5433"
echo "  Redis:             localhost:6379"
echo ""
echo "Press Ctrl+C to stop all services"

trap "kill $PYTHON_PID $NODE_PID 2>/dev/null; docker-compose -f docker-compose.dev.yml down" EXIT
wait
