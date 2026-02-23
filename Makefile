.PHONY: help \
	env-init \
	local-install local-install-frontend local-install-backend \
	local-env-local local-env-prod \
	local-up local-run local-run-frontend local-run-backend local-check-db \
	local-migrate local-makemigrations local-superuser \
	local-test local-test-backend local-test-frontend local-build local-lint local-clean \
	replace-backend replace-frontend replace-app \
	docker-build docker-up docker-down docker-logs docker-ps docker-config docker-seed docker-migrate docker-reset-fresh \
	db-up db-down db-logs db-reset db-grant-test-db-perms \
	docker-prod-build docker-prod-up docker-prod-down docker-prod-logs docker-prod-ps docker-prod-config docker-prod-seed \
	db-prod-up db-prod-down db-prod-logs db-prod-reset

BACKEND_PYTHON := backend/.venv/bin/python
BACKEND_MANAGE := $(BACKEND_PYTHON) backend/manage.py
COMPOSE_BASE_FILE ?= docker-compose.yml
COMPOSE_LOCAL_FILE ?= docker-compose.local.yml
COMPOSE_PROD_FILE ?= docker-compose.prod.yml
DEV_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_LOCAL_FILE)
PROD_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_LOCAL_FILE) -f $(COMPOSE_PROD_FILE)
DB_SERVICE ?= db
LOCAL_KILL_PORTS ?= 3000 3001 3002 3003 3004 3005 8000

# ============================================================================
# HELP
# ============================================================================

help:
	@echo "bill-n-chill - Monorepo Development Commands"
	@echo ""
	@echo "Command Prefix Pattern:"
	@echo "  local-*   direct local workflow commands (frontend/backend on host)"
	@echo "  docker-*  Dockerized dev stack (.env.local)"
	@echo "  db-*      MySQL-only Docker commands for dev (.env.local)"
	@echo "  docker-prod-*  Dockerized prod-like stack (.env.prod)"
	@echo "  db-prod-*      MySQL-only Docker commands for prod-like (.env.prod)"
	@echo ""
	@echo "Local Commands:"
	@echo "  make local-install         - Install all dependencies (frontend + backend)"
	@echo "  make local-run-frontend    - Start Next.js development server on host"
	@echo "  make local-run-backend     - Start Django development server on host"
	@echo "  make local-up              - Run local frontend + backend together"
	@echo "  make local-migrate         - Apply Django migrations"
	@echo "  make local-test            - Run backend tests + frontend lint"
	@echo "  make local-kill-ports      - Kill processes listening on ports 3000-3005/8000"
	@echo "  make replace-backend       - Stop docker backend, run local backend"
	@echo "  make replace-frontend      - Stop docker frontend, run local frontend"
	@echo "  make replace-app           - Stop docker frontend+backend, run local frontend+backend"
	@echo ""
	@echo "Dev Docker Commands (.env.local):"
	@echo "  make docker-up             - Start full dev stack (frontend + backend + mysql)"
	@echo "  make docker-down           - Stop dev stack"
	@echo "  make docker-logs           - Stream dev stack logs"
	@echo "  make docker-migrate        - Apply Django migrations against dev DB"
	@echo "  make docker-reset-fresh    - Destructive DB flush + Bob demo reseed (dev DB)"
	@echo "  make db-up                 - Start only MySQL container (for local host workflow)"
	@echo "  make db-down               - Stop only MySQL container"
	@echo "  make db-grant-test-db-perms - Grant MySQL CREATE/DROP perms for Django test DBs"
	@echo "  make db-reset              - Drop dev DB volume and recreate MySQL container"
	@echo "  make docker-seed           - Seed Bob demo data into dev MySQL database"
	@echo ""
	@echo "Prod-like Docker Commands (.env.prod):"
	@echo "  make docker-prod-up        - Start prod-like stack in detached mode"
	@echo "  make docker-prod-down      - Stop prod-like stack"
	@echo "  make docker-prod-logs      - Stream prod-like stack logs"
	@echo "  make db-prod-up            - Start only prod-like MySQL container"
	@echo "  make docker-prod-seed      - Seed Bob demo data into prod-like MySQL database"

# ============================================================================
# LOCAL (HOST PROCESSES)
# ============================================================================

env-init: local-env-local

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
	@echo "Stopping listeners on ports: $(LOCAL_KILL_PORTS)"
	@for port in $(LOCAL_KILL_PORTS); do \
		if command -v fuser >/dev/null 2>&1; then \
			echo "Port $$port: sending TERM"; \
			fuser -k -TERM $$port/tcp 2>/dev/null || true; \
			sleep 1; \
			if fuser $$port/tcp >/dev/null 2>&1; then \
				echo "Port $$port: still busy, sending KILL"; \
				fuser -k -KILL $$port/tcp 2>/dev/null || true; \
			fi; \
		elif command -v lsof >/dev/null 2>&1; then \
			pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true); \
			if [ -n "$$pids" ]; then \
				echo "Port $$port: sending TERM to PID(s) $$pids"; \
				kill -TERM $$pids 2>/dev/null || true; \
				sleep 1; \
				pids=$$(lsof -tiTCP:$$port -sTCP:LISTEN 2>/dev/null || true); \
				if [ -n "$$pids" ]; then \
					echo "Port $$port: still busy, sending KILL to PID(s) $$pids"; \
					kill -KILL $$pids 2>/dev/null || true; \
				fi; \
			else \
				echo "Port $$port: no listener"; \
			fi; \
		else \
			echo "Port $$port: skipped (install fuser or lsof)"; \
		fi; \
	done

# ============================================================================
# BRIDGE (DOCKER -> LOCAL)
# ============================================================================

replace-backend: local-env-local
	$(DEV_COMPOSE) stop backend
	$(MAKE) local-run-backend

replace-frontend: local-env-local
	$(DEV_COMPOSE) stop frontend
	$(MAKE) local-run-frontend

replace-app: local-env-local
	$(DEV_COMPOSE) stop backend frontend
	$(MAKE) local-up

# ============================================================================
# DOCKER DEV (.env.local)
# ============================================================================

docker-build: local-env-local
	$(DEV_COMPOSE) build

docker-up: local-env-local
	$(DEV_COMPOSE) up --build

docker-down: local-env-local
	$(DEV_COMPOSE) down --remove-orphans

docker-logs: local-env-local
	$(DEV_COMPOSE) logs -f --tail=200

docker-ps: local-env-local
	$(DEV_COMPOSE) ps

docker-config: local-env-local
	$(DEV_COMPOSE) config

docker-seed: local-env-local local-check-db
	$(BACKEND_MANAGE) seed_bob_demo

docker-migrate: local-env-local local-check-db
	$(BACKEND_MANAGE) migrate

docker-reset-fresh: local-env-local local-check-db
	$(BACKEND_MANAGE) reset_fresh_demo

db-up: local-env-local
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

db-down: local-env-local
	$(DEV_COMPOSE) stop $(DB_SERVICE)

db-logs: local-env-local
	$(DEV_COMPOSE) logs -f --tail=200 $(DB_SERVICE)

db-reset: local-env-local
	$(DEV_COMPOSE) down -v --remove-orphans
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

db-grant-test-db-perms: local-env-local
	$(DEV_COMPOSE) exec -T $(DB_SERVICE) sh -lc 'mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" -e "GRANT CREATE, DROP ON *.* TO '\''$$MYSQL_USER'\''@'\''%'\''; GRANT ALL PRIVILEGES ON test_bill_n_chill.* TO '\''$$MYSQL_USER'\''@'\''%'\''; FLUSH PRIVILEGES;"'

# ============================================================================
# DOCKER PROD-LIKE (.env.prod)
# ============================================================================

docker-prod-build: local-env-prod
	$(PROD_COMPOSE) build

docker-prod-up: local-env-prod
	$(PROD_COMPOSE) up -d --build

docker-prod-down: local-env-prod
	$(PROD_COMPOSE) down --remove-orphans

docker-prod-logs: local-env-prod
	$(PROD_COMPOSE) logs -f --tail=200

docker-prod-ps: local-env-prod
	$(PROD_COMPOSE) ps

docker-prod-config: local-env-prod
	$(PROD_COMPOSE) config

docker-prod-seed: local-env-prod local-check-db
	$(BACKEND_MANAGE) seed_bob_demo

db-prod-up: local-env-prod
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

db-prod-down: local-env-prod
	$(PROD_COMPOSE) stop $(DB_SERVICE)

db-prod-logs: local-env-prod
	$(PROD_COMPOSE) logs -f --tail=200 $(DB_SERVICE)

db-prod-reset: local-env-prod
	$(PROD_COMPOSE) down -v --remove-orphans
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

.DEFAULT_GOAL := help
