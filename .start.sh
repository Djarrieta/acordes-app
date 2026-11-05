#!/usr/bin/env bash
set -euo pipefail

PROD_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

cd "$PROD_DIR"
branch="$(git branch --show-current)"
if [[ "$branch" != "main" ]]; then
	printf 'start.sh solo se puede ejecutar desde la rama main; rama actual: %s\n' "${branch:-HEAD desprendido}" >&2
	exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
	printf 'El worktree de produccion tiene cambios rastreados sin confirmar.\n' >&2
	exit 1
fi

git fetch origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
	printf 'main local diverge de origin/main; resuelve la divergencia antes de desplegar.\n' >&2
	exit 1
fi

git pull --ff-only origin main
sudo docker compose config -q
sudo docker compose up -d --build
if ! sudo docker compose ps --status running --services | grep -qx 'web'; then
	printf 'El servicio web no quedo en ejecucion.\n' >&2
	exit 1
fi

printf 'Despliegue de produccion completado.\n'
