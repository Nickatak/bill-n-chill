.PHONY: help \
	env-init \
	local-install local-install-frontend local-install-backend \
	local-env-local local-env-prod \
	local-stop-docker-frontend local-stop-docker-backend \
	local-run-frontend local-run-backend local-check-db \
	local-makemigrations local-superuser \
	local-test local-test-backend local-test-frontend local-clean local-kill-ports \
	docker-up docker-down docker-logs db-migrate \
	db-seed db-reset db-reset-hard db-grant-test-db-perms \
	docker-prod-up docker-prod-down docker-prod-logs \
	db-prod-reset db-prod-reset-hard

BACKEND_PYTHON := .venv/bin/python
BACKEND_MANAGE := $(BACKEND_PYTHON) backend/manage.py
COMPOSE_BASE_FILE ?= docker-compose.yml
COMPOSE_LOCAL_FILE ?= docker-compose.local.yml
COMPOSE_PROD_FILE ?= docker-compose.prod.yml
DEV_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_LOCAL_FILE) --profile dev
PROD_COMPOSE ?= docker compose -f $(COMPOSE_BASE_FILE) -f $(COMPOSE_PROD_FILE)
DB_SERVICE ?= db
LOCAL_KILL_PORTS ?= 3000 3001 3002 3003 3004 3005 8000

# ============================================================================
# HELP
# ============================================================================

help:
	@echo "bill-n-chill - command reference"
	@echo ""
	@echo "Core Local Workflow"
	@echo "  make local-install          Install frontend + backend dependencies"
	@echo "  make local-run-frontend     Stop docker frontend, run Next.js on host"
	@echo "  make local-run-backend      Stop docker backend, run Django on host"
	@echo "  make local-test             Run backend tests + frontend lint"
	@echo ""
	@echo "Core Dev Docker Workflow (.env.local)"
	@echo "  make docker-up              Start full dev stack (detached, with build)"
	@echo "  make docker-down            Stop dev stack"
	@echo "  make docker-logs            Stream dev stack logs"
	@echo "  make db-migrate             Apply Django migrations against dev DB"
	@echo "  make db-seed                Seed optional test accounts into dev DB"
	@echo "  make db-reset               Flush all app data and re-migrate"
	@echo ""
	@echo "Dev DB Utilities (.env.local)"
	@echo "  make db-reset-hard          Drop dev DB volume and recreate DB container"
	@echo "  make db-grant-test-db-perms Grant MySQL CREATE/DROP perms for Django tests"
	@echo ""
	@echo "Prod Docker Workflow (.env.prod)"
	@echo "  make docker-prod-up         Full cycle: force-recreate all prod containers"
	@echo "  make docker-prod-down       Stop prod stack"
	@echo "  make docker-prod-logs       Stream prod stack logs"
	@echo "  make db-prod-reset          Flush all prod app data and re-migrate"
	@echo "  make db-prod-reset-hard     Drop prod DB volume and recreate DB container"
	@echo ""
	@echo "Local Utilities"
	@echo "  make env-init               Switch environment to local (.env.local)"
	@echo "  make local-makemigrations   Create Django migration files"
	@echo "  make local-superuser        Create Django admin user"
	@echo "  make local-clean            Clear local build/cache artifacts"
	@echo "  make local-kill-ports       Manual rescue for ports 3000-3005/8000"

# ============================================================================
# LOCAL (HOST PROCESSES)
# ============================================================================

env-init: local-env-local

local-install: local-install-frontend local-install-backend

local-install-frontend:
	npm install --prefix frontend

local-install-backend:
	python3 -m venv .venv
	$(BACKEND_PYTHON) -m pip install -r backend/requirements.txt

local-env-local:
	./scripts/toggle-env.sh local

local-env-prod:
	./scripts/toggle-env.sh prod

local-stop-docker-frontend: local-env-local
	@$(DEV_COMPOSE) stop frontend >/dev/null 2>&1 || true

local-stop-docker-backend: local-env-local
	@$(DEV_COMPOSE) stop backend >/dev/null 2>&1 || true

local-run-frontend: local-stop-docker-frontend
	env NEXT_PUBLIC_DEBUG=$${NEXT_PUBLIC_DEBUG:-true} npm run dev --prefix frontend

local-run-backend: local-stop-docker-backend local-check-db
	$(BACKEND_MANAGE) runserver

local-check-db:
	@$(BACKEND_PYTHON) scripts/check_db_connection.py

local-makemigrations:
	$(BACKEND_MANAGE) makemigrations

local-superuser:
	$(BACKEND_MANAGE) createsuperuser

local-test: local-test-backend local-test-frontend

local-test-backend:
	$(BACKEND_MANAGE) test core.tests --keepdb --noinput

local-test-frontend:
	npm run lint --prefix frontend
	npx --prefix frontend vitest run

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

# DOCKER DEV (.env.local)
# ============================================================================

docker-up: local-env-local
	$(DEV_COMPOSE) up -d --build

docker-down: local-env-local
	$(DEV_COMPOSE) down --remove-orphans

docker-logs: local-env-local
	$(DEV_COMPOSE) logs -f --tail=200

db-seed: local-env-local local-check-db
	$(BACKEND_MANAGE) seed_adoption_stages

db-migrate: local-env-local local-check-db
	$(BACKEND_MANAGE) migrate

db-reset: local-env-local local-check-db
	$(BACKEND_MANAGE) reset_fresh_demo --skip-seed

db-reset-hard: local-env-local
	@echo "This will destroy the DB volume and all data. Type 'yes' to confirm:"
	@read ans && [ "$$ans" = "yes" ] || (echo "Aborted."; exit 1)
	$(DEV_COMPOSE) down -v --remove-orphans
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

db-grant-test-db-perms: local-env-local
	$(DEV_COMPOSE) exec -T $(DB_SERVICE) sh -lc 'mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" -e "GRANT CREATE, DROP ON *.* TO '\''$$MYSQL_USER'\''@'\''%'\''; GRANT ALL PRIVILEGES ON test_bill_n_chill.* TO '\''$$MYSQL_USER'\''@'\''%'\''; FLUSH PRIVILEGES;"'

# ============================================================================
# DOCKER PROD (.env.prod)
# ============================================================================

docker-prod-up: local-env-prod
	$(PROD_COMPOSE) up -d --force-recreate

docker-prod-down: local-env-prod
	$(PROD_COMPOSE) down --remove-orphans

docker-prod-logs: local-env-prod
	$(PROD_COMPOSE) logs -f --tail=200

db-prod-reset: local-env-prod
	@echo "This will flush ALL prod app data with no reseed. Type 'yes' to confirm:"
	@read ans && [ "$$ans" = "yes" ] || (echo "Aborted."; exit 1)
	$(PROD_COMPOSE) exec -T backend python manage.py reset_fresh_demo --skip-seed

db-prod-reset-hard: local-env-prod
	@echo "This will destroy the prod DB volume and all data. Type 'yes' to confirm:"
	@read ans && [ "$$ans" = "yes" ] || (echo "Aborted."; exit 1)
	$(PROD_COMPOSE) down -v --remove-orphans
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

nuke-account:
	$(DEV_COMPOSE) exec backend python manage.py nuke_account REDACTED_EMAIL

docker-shell-backend:
	$(DEV_COMPOSE) exec backend bash

docker-shell-frontend:
	$(DEV_COMPOSE) exec frontend sh

.DEFAULT_GOAL := help
