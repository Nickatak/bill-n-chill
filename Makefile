.PHONY: help \
	local-install local-install-frontend local-install-backend \
	local-env-local local-env-prod \
	local-up local-run local-run-frontend local-run-backend local-check-db \
	local-migrate local-makemigrations local-superuser \
	local-test local-test-backend local-test-frontend local-build local-lint local-clean \
	dev-build dev-up dev-down dev-logs dev-ps dev-config dev-seed \
	dev-db-up dev-db-down dev-db-logs dev-db-reset \
	prod-build prod-up prod-down prod-logs prod-ps prod-config prod-seed \
	prod-db-up prod-db-down prod-db-logs prod-db-reset \
	install install-frontend install-backend env-local env-prod dev run run-frontend run-backend \
	migrate makemigrations superuser test test-backend test-frontend build lint clean

BACKEND_PYTHON := backend/.venv/bin/python
BACKEND_MANAGE := $(BACKEND_PYTHON) backend/manage.py
COMPOSE_BASE_FILE ?= docker-compose.yml
COMPOSE_LOCAL_FILE ?= docker-compose.local.yml
COMPOSE_PROD_FILE ?= docker-compose.prod.yml
DEV_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_LOCAL_FILE)
PROD_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_LOCAL_FILE) -f $(COMPOSE_PROD_FILE)
DB_SERVICE ?= db

# ============================================================================
# HELP
# ============================================================================

help:
	@echo "bill-n-chill - Monorepo Development Commands"
	@echo ""
	@echo "Command Prefix Pattern:"
	@echo "  local-*   direct local workflow commands (frontend/backend on host)"
	@echo "  dev-*     Dockerized dev stack (.env.local)"
	@echo "  prod-*    Dockerized prod-like stack (.env.prod)"
	@echo ""
	@echo "Local Commands:"
	@echo "  make local-install         - Install all dependencies (frontend + backend)"
	@echo "  make local-run-frontend    - Start Next.js development server on host"
	@echo "  make local-run-backend     - Start Django development server on host"
	@echo "  make local-up              - Run local frontend + backend together"
	@echo "  make local-migrate         - Apply Django migrations"
	@echo "  make local-test            - Run backend tests + frontend lint"
	@echo "  make local-kill-ports      - Kill processes listening on ports 3000-3005/8000"
	@echo ""
	@echo "Dev Docker Commands:"
	@echo "  make dev-up                - Start full dev stack (frontend + backend + mysql)"
	@echo "  make dev-down              - Stop dev stack"
	@echo "  make dev-logs              - Stream dev stack logs"
	@echo "  make dev-db-up             - Start only MySQL container (for local host workflow)"
	@echo "  make dev-db-down           - Stop only MySQL container"
	@echo "  make dev-db-reset          - Drop dev DB volume and recreate MySQL container"
	@echo "  make dev-seed              - Seed Bob demo data into dev MySQL database"
	@echo ""
	@echo "Prod-like Docker Commands:"
	@echo "  make prod-up               - Start prod-like stack in detached mode"
	@echo "  make prod-down             - Stop prod-like stack"
	@echo "  make prod-logs             - Stream prod-like stack logs"
	@echo "  make prod-db-up            - Start only prod-like MySQL container"
	@echo "  make prod-seed             - Seed Bob demo data into prod-like MySQL database"
	@echo ""
	@echo "Legacy aliases retained: install, run, run-frontend, run-backend, migrate, test, build, lint, clean"

# ============================================================================
# LOCAL (HOST PROCESSES)
# ============================================================================

local-install: local-install-frontend local-install-backend

local-install-frontend:
	npm install --prefix frontend

local-install-backend:
	python3 -m venv backend/.venv
	$(BACKEND_PYTHON) -m pip install -r backend/requirements.txt

local-env-local:
	./scripts/toggle-env.sh local

local-env-prod:
	./scripts/toggle-env.sh prod

local-up:
	@echo "Starting frontend and backend servers (press Ctrl+C to stop both)..."
	@(trap 'kill 0' INT TERM; $(MAKE) local-run-frontend & $(MAKE) local-run-backend &)

local-run: local-run-frontend

local-run-frontend:
	npm run dev --prefix frontend

local-run-backend: local-check-db
	$(BACKEND_MANAGE) runserver

local-check-db:
	@$(BACKEND_PYTHON) scripts/check_db_connection.py

local-makemigrations:
	$(BACKEND_MANAGE) makemigrations

local-migrate:
	$(BACKEND_MANAGE) migrate

local-superuser:
	$(BACKEND_MANAGE) createsuperuser

local-test: local-test-backend local-test-frontend

local-test-backend:
	$(BACKEND_MANAGE) test

local-test-frontend:
	npm run lint --prefix frontend

local-build:
	npm run build --prefix frontend

local-lint:
	npm run lint --prefix frontend

local-clean:
	find frontend/.next -type f -delete 2>/dev/null || true
	find frontend/.next -depth -type d -exec rmdir {} \; 2>/dev/null || true
	find frontend/node_modules -type f -delete 2>/dev/null || true
	find frontend/node_modules -depth -type d -exec rmdir {} \; 2>/dev/null || true
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "Clean complete."

local-kill-ports:
	@for port in 3000 3001 3002 3003 3004 3005 8000; do \
		pids=$$(sudo lsof -t -iTCP:$$port -sTCP:LISTEN 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			echo "Killing $$pids on port $$port"; \
			sudo kill $$pids; \
		else \
			echo "No process listening on port $$port"; \
		fi; \
	done

# ============================================================================
# DEV DOCKER (.env.local)
# ============================================================================

dev-build: local-env-local
	$(DEV_COMPOSE) build

dev-up: local-env-local
	$(DEV_COMPOSE) up --build

dev-down: local-env-local
	$(DEV_COMPOSE) down --remove-orphans

dev-logs: local-env-local
	$(DEV_COMPOSE) logs -f --tail=200

dev-ps: local-env-local
	$(DEV_COMPOSE) ps

dev-config: local-env-local
	$(DEV_COMPOSE) config

dev-seed: local-env-local local-check-db
	$(BACKEND_MANAGE) seed_bob_demo

dev-db-up: local-env-local
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

dev-db-down: local-env-local
	$(DEV_COMPOSE) stop $(DB_SERVICE)

dev-db-logs: local-env-local
	$(DEV_COMPOSE) logs -f --tail=200 $(DB_SERVICE)

dev-db-reset: local-env-local
	$(DEV_COMPOSE) down -v --remove-orphans
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

# ============================================================================
# PROD-LIKE DOCKER (.env.prod)
# ============================================================================

prod-build: local-env-prod
	$(PROD_COMPOSE) build

prod-up: local-env-prod
	$(PROD_COMPOSE) up -d --build

prod-down: local-env-prod
	$(PROD_COMPOSE) down --remove-orphans

prod-logs: local-env-prod
	$(PROD_COMPOSE) logs -f --tail=200

prod-ps: local-env-prod
	$(PROD_COMPOSE) ps

prod-config: local-env-prod
	$(PROD_COMPOSE) config

prod-seed: local-env-prod local-check-db
	$(BACKEND_MANAGE) seed_bob_demo

prod-db-up: local-env-prod
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

prod-db-down: local-env-prod
	$(PROD_COMPOSE) stop $(DB_SERVICE)

prod-db-logs: local-env-prod
	$(PROD_COMPOSE) logs -f --tail=200 $(DB_SERVICE)

prod-db-reset: local-env-prod
	$(PROD_COMPOSE) down -v --remove-orphans
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

# ============================================================================
# LEGACY ALIASES
# ============================================================================

install: local-install
install-frontend: local-install-frontend
install-backend: local-install-backend
env-local: local-env-local
env-prod: local-env-prod

dev: local-up
run: local-run
run-frontend: local-run-frontend
run-backend: local-run-backend

makemigrations: local-makemigrations
migrate: local-migrate
superuser: local-superuser

test: local-test
test-backend: local-test-backend
test-frontend: local-test-frontend
build: local-build
lint: local-lint
clean: local-clean
