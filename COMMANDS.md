# Příkazy pro spuštění benchmarku z terminálu

Tento přehled obsahuje všechny dostupné `npm` a `node` příkazy pro spuštění benchmarkové sady pro **Kategorii 2: Souborové I/O operace** (Node.js).

---

## 🚀 Rychlý přehled npm skriptů

| Příkaz                              | Popis                                                                  |
| :---------------------------------- | :--------------------------------------------------------------------- |
| `npm start`                         | Spustí plný benchmark obou scénářů (10× warmup + 30 měřených iterací). |
| `npm run bench`                     | Alias pro plný běh benchmarku.                                         |
| `npm run bench:file-io`             | Spustí kompletní modul File I/O dle konfigurace v `config.json`.       |
| `npm run bench:file-io:quick`       | Rychlý ověřovací běh (2× warmup + 5 iterací) pro oba scénáře.          |
| `npm run bench:file-io:large`       | Plný běh **pouze Varianty A** (1× 100 MB sekvenční streamování).       |
| `npm run bench:file-io:small`       | Plný běh **pouze Varianty B** (1 000× 4 KB souborů, systémová režie).  |
| `npm run bench:file-io:large:quick` | Rychlý běh pouze Varianty A (2× warmup + 5 iterací).                   |
| `npm run bench:file-io:small:quick` | Rychlý běh pouze Varianty B (2× warmup + 5 iterací).                   |
| `npm run clean:results`             | Smaže složku `results/` s naměřenými daty.                             |
| `npm run clean:temp`                | Bezpečně promaže dočasnou složku `temp/`.                              |

---

## 🛠️ Spuštění s vlastními parametry (přes `npm` s `--`)

Pokud chcete z terminálu předat vlastní počet iterací nebo zahřívacích cyklů, použijte oddělovač `--`:

```bash
# Vlastní počet zahřívacích cyklů a iterací pro celou sadu
npm run bench:file-io -- --warmup=5 --iterations=20

# Vlastní běh pouze pro velký 100MB soubor
npm run bench:file-io -- --scenario=large --warmup=3 --iterations=10

# Vlastní běh pouze pro 1 000 malých souborů
npm run bench:file-io -- --scenario=small --warmup=5 --iterations=15
```

---

## 💻 Přímé spuštění přes `node` (alternativa bez npm)

```bash
# Základní spuštění dle výchozího config.json
node runner.js

# Rychlý test
node runner.js --warmup=2 --iterations=5

# Pouze Varianta A (Velký soubor 100 MB)
node runner.js --scenario=large

# Pouze Varianta B (1 000 malých 4KB souborů)
node runner.js --scenario=small

# Kombinace filtru scénáře a vlastních iterací
node runner.js --scenario=large --warmup=5 --iterations=10
```

---

## 📂 Kam se ukládají výsledky měření?

Po dokončení benchmarku se výsledky automaticky exportují do složky `results/`:

- `results/file_io_raw_node.json` – detailní pole všech jednotlivých iterací (časy zápisu, čtení, propustnost, paměť RSS před a po).
- `results/file_io_summary_node.json` – statistické vyhodnocení (medián $p50$, $p95$, $p99$, průměr $\mu$, směrodatná odchylka $\sigma$, min, max).
