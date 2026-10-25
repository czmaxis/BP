# Příkazy pro spuštění benchmarku z terminálu

Tento přehled obsahuje všechny dostupné příkazy pro spuštění benchmarkové sady pro **Kategorii 2: Souborové I/O operace** ve všech třech běhových prostředích (**Node.js**, **Deno**, **Bun**), ať už **lokálně** nebo **v izolovaných Docker kontejnerech**.

---

## 🐳 1. Spuštění v Dockeru (Izolované kontejnery s limity CPU/RAM)

Orchestrátor [runner-docker.js](file:///f:/unicorn/zdrojaky/BP/runner-docker.js) automaticky sestaví obrazy (`benchmark-node`, `benchmark-deno`, `benchmark-bun`), postupně (sekvenčně) spustí kontejnery s omezením `--cpus=2 --memory=2g --memory-swap=2g`, uloží výsledky přes svazek `./results:/app/results` (zatímco testovací I/O v `/app/temp` probíhá čistě uvnitř kontejneru) a nakonec zobrazí srovnávací tabulku.

| Příkaz | Popis |
| :--- | :--- |
| `npm run benchmark:docker` | **Plný Docker benchmark:** Sestaví a sekvenčně spustí všechna 3 prostředí (10× warmup + 30 iterací) a porovná výsledky. |
| `npm run benchmark:docker:quick` | **Rychlý Docker test:** Sestaví a spustí všechna 3 prostředí v rychlém režimu (2× warmup + 5 iterací). |
| `npm run benchmark:docker:node` | Sestaví a spustí v Dockeru **pouze Node.js** kontejner. |
| `npm run benchmark:docker:deno` | Sestaví a spustí v Dockeru **pouze Deno** kontejner. |
| `npm run benchmark:docker:bun` | Sestaví a spustí v Dockeru **pouze Bun** kontejner. |

### Pokročilé parametry pro Docker orchestrátor:
```bash
# Změna limitu CPU na 1 jádro a RAM na 2 GB
node runner-docker.js --cpus=1 --memory=2g

# Přeskočení buildu obrazů (pokud již jsou sestavené) a rychlý běh
node runner-docker.js --skip-build --warmup=2 --iterations=5

# Spuštění pouze jednoho prostředí s vlastními parametry
node runner-docker.js --runtime=node --warmup=3 --iterations=10
```

### Ruční Docker CLI příkazy (např. na Linux VPS Hetzner):
```bash
# 1. Sestavení obrazů
docker build -t benchmark-node -f docker/Dockerfile.node .
docker build -t benchmark-deno -f docker/Dockerfile.deno .
docker build -t benchmark-bun  -f docker/Dockerfile.bun .

# 2. Sekvenční spuštění s limity zdrojů (--cpus=2, --memory=2g, vypnutý swap)
docker run --rm --cpus=2 --memory=2g --memory-swap=2g -v "$(pwd)/results:/app/results" benchmark-node
docker run --rm --cpus=2 --memory=2g --memory-swap=2g -v "$(pwd)/results:/app/results" benchmark-deno
docker run --rm --cpus=2 --memory=2g --memory-swap=2g -v "$(pwd)/results:/app/results" benchmark-bun
```

---

## 💻 2. Lokální spuštění (přímo na hostitelském OS)

| Příkaz | Prostředí | Popis |
| :--- | :---: | :--- |
| `npm start` / `npm run bench:file-io` | **Node.js** | Spustí plný benchmark obou scénářů (10× warmup + 30 měřených iterací). |
| `npm run bench:file-io:quick` | **Node.js** | Rychlý ověřovací běh (2× warmup + 5 iterací) pro oba scénáře. |
| `npm run bench:file-io:large` | **Node.js** | Plný běh **pouze Varianty A** (1× 100 MB sekvenční streamování). |
| `npm run bench:file-io:small` | **Node.js** | Plný běh **pouze Varianty B** (1 000× 4 KB souborů, systémová režie). |
| `npm run bench:file-io:deno` | **Deno** | Spustí plný benchmark v Deno (10× warmup + 30 měřených iterací). |
| `npm run bench:file-io:deno:quick` | **Deno** | Rychlý ověřovací běh v Deno (2× warmup + 5 iterací). |
| `npm run bench:file-io:bun` | **Bun** | Spustí plný benchmark v Bun (10× warmup + 30 měřených iterací). |
| `npm run bench:file-io:bun:quick` | **Bun** | Rychlý ověřovací běh v Bun (2× warmup + 5 iterací). |
| `npm run compare` | **Porovnání** | Načte summary soubory všech 3 prostředí, vykreslí srovnávací tabulku a uloží `results/file_io_comparison.json`. |
| `npm run clean:results` | *Obecné* | Smaže složku `results/` s naměřenými daty. |
| `npm run clean:temp` | *Obecné* | Bezpečně promaže dočasnou složku `temp/`. |

---

## 📂 Kam se ukládají výsledky měření?

Po dokončení benchmarku (lokálně i v Dockeru) se výsledky automaticky exportují do složky `results/`:

- **Node.js:** `results/file_io_raw_node.json`, `results/file_io_summary_node.json`
- **Deno:** `results/file_io_raw_deno.json`, `results/file_io_summary_deno.json`
- **Bun:** `results/file_io_raw_bun.json`, `results/file_io_summary_bun.json`
- **Společné porovnání:** `results/file_io_comparison.json`
