# Guía para agentes

- Sigue los patrones existentes de TypeScript estricto y mantén la interfaz en español.
- Conserva las responsabilidades separadas: parser en `src/parser/`, transposición en `src/transpose/`, renderizado en `src/render/` y rutas en `src/routes/`.
- Al cambiar la descarga o el parseo, conserva la validación de URL y las pruebas con fixtures; no dependas de la red en pruebas.
- Ejecuta `bun run test` y `bun run typecheck` después de cambios de código.
- No guardes secretos ni el archivo `.env`; `.env.example` contiene los valores de ejemplo.
- Consulta [README.md](./README.md) para instalación, ejecución y estructura del proyecto.

## Producción (Docker + Cloudflare)

**No hay entorno dev/prod separado: todo es producción (POC).** La app está
desplegada en <https://acordes.ingeniar.online/>. El desarrollo se hace por SSH
sobre el servidor, así que **no se valida en `localhost`**: cada cambio se publica
reconstruyendo el contenedor y se comprueba en esa URL pública. Al ser una POC,
está permitido romperla durante la iteración.

Flujo para publicar y validar:

1. Verificar código: `bun run test && bun run typecheck`.
2. Sincronizar remoto (SSH, evita cuelgue de askpass HTTPS):
   `git push origin main`.
3. Reconstruir y relanzar contenedor:
   `docker compose config -q && docker compose up -d --build`.
4. Verificar el despliegue: `docker compose ps --status running --services` debe
   incluir `web`, y la URL pública debe responder HTML:
   `curl -sS -m 10 -I https://acordes.ingeniar.online/` (HTTP 200).
5. Túnel Cloudflare: el proceso `cloudflared tunnel run --token ...` ya corre
   (PID visible con `pgrep -af 'cloudflared tunnel run'`). No requiere reinicio
   tras rebuild; el contenedor reutiliza el puerto host `127.0.0.1:4173`.
   Si no está activo, relanzarlo con el token correspondiente (no documentar el token).

Notas:
- La validación funcional/visual siempre se hace en <https://acordes.ingeniar.online/>,
  no en `http://127.0.0.1:4173`; ese puerto local solo lo consume el túnel.
- `.start.sh` invoca `sudo`, que puede pedir contraseña en este entorno; si falla,
  ejecutar los comandos de Docker directamente (el usuario ya tiene acceso a Docker).
- El remoto debe ser SSH (`git@github.com:Djarrieta/acordes-app.git`); HTTPS cuelga
  esperando `gnome-ssh-askpass`.
