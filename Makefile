.PHONY: help install install-frontend install-backend dev run run-frontend run-backend \
	migrate makemigrations superuser test test-backend test-frontend build lint \
	env-local env-prod clean

BACKEND_PYTHON := backend/.venv/bin/python
BACKEND_MANAGE := $(BACKEND_PYTHON) backend/manage.py

# ============================================================================
# HELP
# ============================================================================

help:
	@echo "Buildr - Monorepo Development Commands"
	@echo ""
	@echo "Installation:"
	@echo "  make install              - Install all dependencies (frontend + backend)"
	@echo "  make install-frontend     - Install frontend dependencies only"
	@echo "  make install-backend      - Create backend venv and install dependencies"
	@echo ""
	@echo "Environment:"
	@echo "  make env-local            - Activate .env.local as .env"
	@echo "  make env-prod             - Activate .env.prod as .env"
	@echo ""
	@echo "Development:"
	@echo "  make dev                  - Run frontend and backend servers concurrently"
	@echo "  make run-frontend         - Start Next.js development server"
	@echo "  make run-backend          - Start Django development server"
	@echo ""
	@echo "Database:"
	@echo "  make makemigrations       - Generate Django migrations"
	@echo "  make migrate              - Apply Django migrations"
	@echo "  make superuser            - Create Django superuser"
	@echo ""
	@echo "Quality:"
	@echo "  make test                 - Run backend tests and frontend lint"
	@echo "  make test-backend         - Run Django tests"
	@echo "  make test-frontend        - Run frontend lint"
	@echo "  make build                - Build frontend for production"
	@echo "  make lint                 - Run frontend lint"
	@echo ""
	@echo "Utilities:"
	@echo "  make clean                - Remove common local build/cache artifacts"

# ============================================================================
# INSTALLATION
# ============================================================================

install: install-frontend install-backend

install-frontend:
	npm install --prefix frontend

install-backend:
	python3 -m venv backend/.venv
	$(BACKEND_PYTHON) -m pip install -r backend/requirements.txt

# ============================================================================
# ENVIRONMENT
# ============================================================================

env-local:
	./scripts/toggle-env.sh local

env-prod:
	./scripts/toggle-env.sh prod

# ============================================================================
# DEVELOPMENT
# ============================================================================

dev:
	@echo "Starting frontend and backend servers (press Ctrl+C to stop both)..."
	@(trap 'kill 0' SIGINT; $(MAKE) run-frontend & $(MAKE) run-backend &)

run: run-frontend

run-frontend:
	npm run dev --prefix frontend

run-backend:
	$(BACKEND_MANAGE) runserver

# ============================================================================
# DATABASE
# ============================================================================

makemigrations:
	$(BACKEND_MANAGE) makemigrations

migrate:
	$(BACKEND_MANAGE) migrate

superuser:
	$(BACKEND_MANAGE) createsuperuser

# ============================================================================
# QUALITY
# ============================================================================

test: test-backend test-frontend

test-backend:
	$(BACKEND_MANAGE) test

test-frontend:
	npm run lint --prefix frontend

build:
	npm run build --prefix frontend

lint:
	npm run lint --prefix frontend

# ============================================================================
# UTILITIES
# ============================================================================

clean:
	find frontend/.next -type f -delete 2>/dev/null || true
	find frontend/.next -depth -type d -exec rmdir {} \; 2>/dev/null || true
	find frontend/node_modules -type f -delete 2>/dev/null || true
	find frontend/node_modules -depth -type d -exec rmdir {} \; 2>/dev/null || true
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "Clean complete."
