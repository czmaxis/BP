# Příkazy pro spuštění benchmarku z terminálu

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady pro **Kategorii 2: Souborové I/O operace** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**), ať už **lokálně** nebo **v izolovaných Docker kontejnerech**.

---

## 1. Hlavní spuštění pro všechna prostředí najednou (Lokálně)

Příkaz `npm start` (nebo `npm run bench:all`) automaticky:

1. Zjistí cesty k binárkám Node.js, Deno i Bun.
2. Sekvenčně (postupně za sebou) spustí plný benchmark pro **Node.js**, **Deno** i **Bun** (10× warmup + 30 měřených iterací).
3. Na konci automaticky spustí `compare.js`, který vygeneruje srovnávací tabulku do konzole a uloží `results/file_io_comparison.json`.

| Příkaz                    | Popis                                                                                                                        |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------------------- |
| `npm start`               | **Plný běh všech 3 prostředí:** Postupně spustí Node.js, Deno a Bun (10× warmup + 30 iterací) a vykreslí srovnávací tabulku. |
| `npm run bench:all:quick` | **Rychlý běh všech 3 prostředí:** Spustí Node.js, Deno a Bun v rychlém režimu (2× warmup + 5 iterací) a porovná je.          |
| `npm run compare`         | Samostatné vyhodnocení – načte existující data z `results/` a vykreslí srovnávací tabulku.                                   |

### Vlastní parametry pro `npm start` (přes `--`):

```bash
# Všechna 3 prostředí s vlastním počtem iterací:
npm start -- --warmup=5 --iterations=20

# Všechna 3 prostředí pouze pro velký 100MB soubor:
npm start -- --scenario=large

# Všechna 3 prostředí pouze pro malé soubory v rychlém režimu:
npm start -- --quick --scenario=small
```

---

## 2. Spuštění jednotlivých prostředí samostatně (Lokálně)

Pokud chcete spustit test pouze pro jedno konkrétní prostředí:

| Příkaz                             |  Prostředí  | Popis                                                    |
| :--------------------------------- | :---------: | :------------------------------------------------------- |
| `npm run bench:node`               | **Node.js** | Plné měření pouze pro Node.js (10× warmup + 30 iterací). |
| `npm run bench:file-io:quick`      | **Node.js** | Rychlý test pouze pro Node.js (2× warmup + 5 iterací).   |
| `npm run bench:file-io:large`      | **Node.js** | Pouze Varianta A (100 MB streamování) pro Node.js.       |
| `npm run bench:file-io:small`      | **Node.js** | Pouze Varianta B (1 000× 4 KB soubory) pro Node.js.      |
| `npm run bench:deno`               |  **Deno**   | Plné měření pouze pro Deno (10× warmup + 30 iterací).    |
| `npm run bench:file-io:deno:quick` |  **Deno**   | Rychlý test pouze pro Deno (2× warmup + 5 iterací).      |
| `npm run bench:file-io:deno:large` |  **Deno**   | Pouze Varianta A (100 MB streamování) pro Deno.          |
| `npm run bench:file-io:deno:small` |  **Deno**   | Pouze Varianta B (1 000× 4 KB soubory) pro Deno.         |
| `npm run bench:bun`                |   **Bun**   | Plné měření pouze pro Bun (10× warmup + 30 iterací).     |
| `npm run bench:file-io:bun:quick`  |   **Bun**   | Rychlý test pouze pro Bun (2× warmup + 5 iterací).       |
| `npm run bench:file-io:bun:large`  |   **Bun**   | Pouze Varianta A (100 MB streamování) pro Bun.           |
| `npm run bench:file-io:bun:small`  |   **Bun**   | Pouze Varianta B (1 000× 4 KB soubory) pro Bun.          |
| `npm run clean:results`            |   _Úklid_   | Smaže složku `results/` s naměřenými daty.               |
| `npm run clean:temp`               |   _Úklid_   | Bezpečně promaže dočasnou složku `temp/`.                |

---

## 3. Spuštění v Dockeru (Izolované kontejnery s limity CPU/RAM)

Orchestrátor [runner-docker.js](file:///f:/unicorn/zdrojaky/BP/runner-docker.js) automaticky sestaví obrazy (`benchmark-node`, `benchmark-deno`, `benchmark-bun`), postupně spustí kontejnery s omezením `--cpus=2 --memory=2g --memory-swap=2g`, uloží výsledky přes svazek `./results:/app/results` a nakonec zobrazí srovnávací tabulku.

| Příkaz                           | Popis                                                                                                                   |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `npm run benchmark:docker`       | **Plný Docker benchmark:** Sestaví a sekvenčně spustí všechna 3 prostředí (10× warmup + 30 iterací) a porovná výsledky. |
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu (2× warmup + 5 iterací).                  |
| `npm run benchmark:docker:node`  | Sestaví a spustí v Dockeru **pouze Node.js** kontejner.                                                                 |
| `npm run benchmark:docker:deno`  | Sestaví a spustí v Dockeru **pouze Deno** kontejner.                                                                    |
| `npm run benchmark:docker:bun`   | Sestaví a spustí v Dockeru **pouze Bun** kontejner.                                                                     |

---

## Místo pro uložení výsledků

Po dokončení benchmarku se výsledky automaticky exportují do složky `results/`:

- **Node.js:** `results/file_io_raw_node.json`, `results/file_io_summary_node.json`
- **Deno:** `results/file_io_raw_deno.json`, `results/file_io_summary_deno.json`
- **Bun:** `results/file_io_raw_bun.json`, `results/file_io_summary_bun.json`
- **Sjednocené porovnání:** `results/file_io_comparison.json`
