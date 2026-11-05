# Guía para agentes

- Sigue los patrones existentes de TypeScript estricto y mantén la interfaz en español.
- Conserva las responsabilidades separadas: parser en `src/parser/`, transposición en `src/transpose/`, renderizado en `src/render/` y rutas en `src/routes/`.
- Al cambiar la descarga o el parseo, conserva la validación de URL y las pruebas con fixtures; no dependas de la red en pruebas.
- Ejecuta `bun run test` y `bun run typecheck` después de cambios de código.
- No guardes secretos ni el archivo `.env`; `.env.example` contiene los valores de ejemplo.
- Consulta [README.md](./README.md) para instalación, ejecución y estructura del proyecto.
