# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje kompletní **Kategorii 2: Souborové I/O operace** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**, a to jak pro lokální spouštění, tak pro izolovaný běh v **Dockeru**.

---

## Přehled modulů Kategorie 2 (File I/O)

1. **Varianta A: Sekvenční streamování – Velký soubor (1× 100 MB)**
   - Testuje hrubou propustnost I/O a chování paměti při sekvenčním zpracování po 64KB blocích.
   - **Node.js:** Nativní blokový zápis (`fs.promises.open` + `fileHandle.write`) a sekvenční čtení po 64KB blocích přes file descriptor (`fs.promises.open` + `fileHandle.read`).
   - **Deno:** Nativní blokový zápis (`Deno.open` + `file.write`) a sekvenční čtení po 64KB blocích (`Deno.open` + `file.read`).
   - **Bun:** Nativní proudový zápis (`Bun.file(path).writer({ highWaterMark })` – `FileSink`) a sekvenční čtení po 64KB blocích přes file descriptor (`fs.promises.open` + `fileHandle.read`).
2. **Varianta B: Systémová režie – Malé soubory (1 000× 4 KB)**
   - Testuje režii systémových volání OS, metadata souborového systému a zatížení interního I/O thread poolu (`libuv` v Node.js, Tokio/Rust v Deno, Zig I/O v Bun).
   - **Node.js:** Paralelní `Promise.all` s `writeFile` a `readFile` z `node:fs/promises`.
   - **Deno:** Paralelní `Promise.all` s `Deno.writeFile` a `Deno.readFile`.
   - **Bun:** Paralelní `Promise.all` s `Bun.write()` a `Bun.file().bytes()`.

---

## Příkazy pro spuštění z terminálu

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/COMMANDS.md).

### Hlavní spuštění (Všechna 3 prostředí lokálně)

```bash
# Plný běh všech 3 prostředí (10 warmup + 30 iterací) + srovnávací tabulka
npm start

# Rychlý ověřovací běh všech 3 prostředí (2 warmup + 5 iterací)
npm run bench:all:quick
```

### Spuštění jednotlivých prostředí samostatně

```bash
npm run bench:node   # Pouze Node.js
npm run bench:deno   # Pouze Deno
npm run bench:bun    # Pouze Bun
npm run compare      # Pouze zobrazení srovnávací tabulky z existujících výsledků
```

### Izolované spuštění v Dockeru (s limity --cpus=2 --memory=2g)

```bash
npm run benchmark:docker        # Všechna 3 prostředí v Dockeru
npm run benchmark:docker:quick  # Rychlý test v Dockeru
npm run benchmark:docker:node   # Pouze Node.js kontejner
```

---

## Architektura sdíleného jádra (`core/`)

Společná logika pro všechna tři běhová prostředí je rozdělena do jednoúčelových modulů v adresáři `core/`:

- `core/runtime.js` – Detekce prostředí (Node.js, Deno, Bun), čtení RSS paměti, CLI argumentů a HW/OS metadat.
- `core/stats.js` – Statistické výpočty ($p50$, $p95$, $p99$, průměr, směrodatná odchylka $\sigma$) a výpočet metrik iterací.
- `core/fs-helper.js` – Práce se souborovým systémem, správa adresáře `temp/`, generování náhodných dat a ukládání JSON výsledků.
- `core/process.js` – Spouštění podprocesů a vyhledávání binárek pro orchestrátory.
- `core/scenario-templates.js` – Sdílené šablony životního cyklu pro Variantu A (100 MB) a Variantu B (1 000 × 4 KB).
- `core/logger.js` – Konzolový výpis průběhu, tabulek a hlavní běhový orchestrátor sady.
- `core/utils.js` – Rozcestník (barrel export) re-exportující všechny výše uvedené moduly.

---

## Výstupní data

Výsledky se ukládají ve formátu JSON do adresáře `results/`:

- **Node.js:** `results/file_io_raw_node.json`, `results/file_io_summary_node.json`
- **Deno:** `results/file_io_raw_deno.json`, `results/file_io_summary_deno.json`
- **Bun:** `results/file_io_raw_bun.json`, `results/file_io_summary_bun.json`
- **Sjednocené porovnání:** `results/file_io_comparison.json`
