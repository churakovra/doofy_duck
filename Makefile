COMPOSE = docker compose --env-file .env.dev -f deploy/compose.yaml --profile local
SERVICE ?=

.PHONY: help install run run-account stop logs status

help:
	@printf '%s\n' \
	  'Local practice: make install, then make run (http://127.0.0.1:4173/).' \
	  'Account mode needs Docker Compose, uv, and Python; make run-account starts the backend and frontend.' \
	  'run and run-account keep the frontend in the foreground; press Ctrl-C to stop it.' \
	  '  make install       install Node dependencies' \
	  '  make run           run the local game without Docker' \
	  '  make run-account   start local account backend, then run the game' \
	  '  make stop          stop backend containers; keep database data' \
	  '  make logs          follow all backend logs, or use SERVICE=core' \
	  '  make status        show backend container status'

install:
	npm ci

run:
	npm run dev

# Keep bootstrap, Compose startup, and Vite in one ordered recipe. Existing
# credentials are retained; any failure prevents the next step from running.
run-account:
	@if test -e .env.dev; then \
	  printf '%s\n' 'Keeping existing .env.dev'; \
	else \
	  (cd services/platform && uv run python ../../deploy/scripts/generate-dev-keys.py); \
	fi && $(COMPOSE) up --build -d && npm run dev

stop:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow $(SERVICE)

status:
	$(COMPOSE) ps
