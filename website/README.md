# Сайт

React + Vite. Данные берутся из корня репозитория (`reviews/cards.json`, `plans/programme.json`, `docs/technique.md`) скриптом `scripts/refresh-data.mjs` перед сборкой.

```sh
npm --prefix website ci
npm --prefix website run dev     # локально
npm --prefix website run build   # в website/dist
```

Публикация — автоматически GitHub Actions (`.github/workflows/pages.yml`) при push в `main`.
