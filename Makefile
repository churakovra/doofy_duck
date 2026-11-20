COMPOSE = docker compose --env-file .env.dev -f deploy/compose.yaml
SERVICE ?=
DEV_USER_ID ?= 100000001

.PHONY: help install run stop logs status

help:
	@printf '%s\n' \
	  'Local account game: make install, then make run (http://127.0.0.1:4173/).' \
	  'make run needs Docker Compose, Python, and the backend prerequisites.' \
	  'make run keeps Vite in the foreground; press Ctrl-C to stop it.' \
	  '  make install       install Node dependencies' \
	  '  make run           start the account backend and game' \
	  '  make run DEV_USER_ID=123456  use a different local development identity' \
	  '  make stop          stop backend containers; keep database data' \
	  '  make logs          follow all backend logs, or use SERVICE=core' \
	  '  make status        show backend container status'

install:
	npm ci

run:
	@if test ! -e .env.dev; then \
	  (cd services/platform && uv run python ../../deploy/scripts/generate-dev-keys.py); \
	fi
	python3 deploy/scripts/ensure_dev_env.py
	DD_DEV_TELEGRAM_USER_ID=$(DEV_USER_ID) $(COMPOSE) up --build -d
	VITE_DD_DEV_AUTH_ENABLED=true VITE_DD_DEV_USER_ID=$(DEV_USER_ID) npm run dev

stop:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs --follow $(SERVICE)

status:
	$(COMPOSE) ps
