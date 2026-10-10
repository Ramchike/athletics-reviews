# Спринт 60/100 м — Рамир и Миша

**Сайт для телефона: https://ramchike.github.io/athletics-reviews/**

Двое новичков по 19 лет готовятся к 60 и 100 м. Цель — II разряд (ручной: 60 м — 7,4, 100 м — 11,8). Сейчас: 100 м — 13,1 (октябрь 2026).

| Что | Где |
| --- | --- |
| Как бежать быстрее: маршрут и честные ожидания | [docs/roadmap.md](docs/roadmap.md) |
| Техника по фазам: как правильно, самые дорогие ошибки | [docs/technique.md](docs/technique.md) |
| Последний разбор видео (вердикты 🟢/🔴/⚪) | [reviews/cards.json](reviews/cards.json), [на сайте](https://ramchike.github.io/athletics-reviews/#/review) |
| Этапы, упражнения (EN/RU), тренировки | [plans/programme.json](plans/programme.json), [на сайте](https://ramchike.github.io/athletics-reviews/) |
| Журнал занятий | [sessions/](sessions/) |
| Разряды, соревнования, исходный большой отчёт | [docs/report.md](docs/report.md), [docs/competitions.md](docs/competitions.md) |
| Что раздражало в прошлых разборах | [docs/feedback.md](docs/feedback.md) |
| Исследования и источники | [docs/start-research.md](docs/start-research.md), [docs/start-sources.md](docs/start-sources.md), [docs/sources.md](docs/sources.md) |

## Как пользоваться с агентом (Codex / Claude Code)

Открыть эту папку и писать обычными словами. Скиллы подхватываются сами: `.agents/skills/` (Codex), `.claude/skills/` (Claude Code, ссылка на ту же папку).

- **sprint-coach** — «Я Рамир, завтра манеж. Что делаем?», «Запиши тренировку: …».
- **sprint-video-review** — «Вот папка с видео: <ссылка на Google Drive>. Разбери старты Миши».
- **sprint-research** — «Пересерчи, как правильно делать B-skip».

## Видео

Оригиналы лежат на Google Drive (папка открыта по ссылке). Агент их не скачивает. `scripts/drive.py` показывает список файлов, `scripts/stream_frames.py --drive <id>` достаёт нужные кадры по HTTP Range в локальную `media/` (не в git). Выбранные размеченные кадры для сайта — в `reviews/assets/`.

```sh
uv venv -p 3.12 ~/.cache/athletics-py && uv pip install -p ~/.cache/athletics-py -r requirements.txt
~/.cache/athletics-py/bin/python scripts/drive.py <ссылка-на-папку>
~/.cache/athletics-py/bin/python scripts/stream_frames.py --drive <id> --out media/<имя> --count 16
```

## Сайт

`website/` (React + Vite). Собирается и публикуется GitHub Actions при каждом push в `main`. Локально: `npm --prefix website ci && npm --prefix website run dev`.
