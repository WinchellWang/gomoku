# Gomoku Local Arena

A static, installable 15 × 15 freestyle Gomoku web app with local PvP and PvE mode. In PvE, the human always plays Black and moves first.

- PvP Undo removes one move.
- PvE Undo removes the latest human/AI pair and is available only on the human turn.
- PvE uses the memory-efficient Rapfi build on every platform, with a three-second search limit.

## Run locally with Docker

```bash
docker compose up --build
```

Open:

```text
http://localhost:8080
```
