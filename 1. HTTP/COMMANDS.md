# Příkazy pro spuštění HTTP benchmarku z terminálu (Kategorie 1: 01-http)

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady **Kategorie 1: Výkon HTTP serveru** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**).

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

| Příkaz                    | Popis                                                                                                                               |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně spustí Node.js, Deno a Bun (10s warmup + 10 × 30s běhů pro 3 endpointy) a porovná výsledky. |
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (1s warmup + 3 × 2s běhy) a vykreslí srovnání.        |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/` a vykreslí srovnávací tabulku.                                          |

### Vlastní parametry (přes `--`):

```bash
# Vlastní počet souběžných spojení (např. 100), délka běhu a počet iterací:
npm start -- --connections=100 --duration=30 --iterations=10

# Testování pouze jednoho vybraného endpointu (plaintext | json | echo):
npm run bench:all:quick -- --endpoint=plaintext
npm run bench:all:quick -- --endpoint=json
npm run bench:all:quick -- --endpoint=echo
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

| Příkaz                     |  Prostředí  | Popis                                                              |
| :------------------------- | :---------: | :----------------------------------------------------------------- |
| `npm run bench:node`       | **Node.js** | Plné měření pouze pro Node.js (`node:http`).                       |
| `npm run bench:node:quick` | **Node.js** | Rychlý test pouze pro Node.js (1s warmup + 3 × 2s běhy).           |
| `npm run bench:deno`       |  **Deno**   | Plné měření pouze pro Deno (`Deno.serve`).                         |
| `npm run bench:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (1s warmup + 3 × 2s běhy).              |
| `npm run bench:bun`        |   **Bun**   | Plné měření pouze pro Bun (`Bun.serve`).                           |
| `npm run bench:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (1s warmup + 3 × 2s běhy).               |
| `npm run clean:results`    |   _Úklid_   | Smaže složku `results/` s naměřenými daty.                         |

---

## 3. Spuštění v Dockeru (Izolované kontejnery serverů s limity CPU/RAM)

| Příkaz                           | Popis                                                                                                  |
| :------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `npm run benchmark:docker`       | **Plný Docker benchmark:** Sestaví a sekvenčně spustí kontejnery všech 3 prostředí a porovná výsledky. |
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu.                         |
| `npm run benchmark:docker:node`  | Sestaví a spustí v Dockeru **pouze Node.js** HTTP server.                                              |
| `npm run benchmark:docker:deno`  | Sestaví a spustí v Dockeru **pouze Deno** HTTP server.                                                 |
| `npm run benchmark:docker:bun`   | Sestaví a spustí v Dockeru **pouze Bun** HTTP server.                                                  |

---

## Místo pro uložení výsledků

Po dokončení benchmarku se výsledky automaticky exportují do složky `1. HTTP/results/`:

- **Node.js:** `results/http_raw_node.json`, `results/http_summary_node.json`
- **Deno:** `results/http_raw_deno.json`, `results/http_summary_deno.json`
- **Bun:** `results/http_raw_bun.json`, `results/http_summary_bun.json`
- **Sjednocené porovnání:** `results/http_comparison.json`
