# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: _„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“_.

Tento modul implementuje **Kategorii 2: Souborové I/O operace** pro **Node.js** a **Deno** (s připravenou architekturou pro **Bun**).

---

## 📋 Přehled modulů Kategorie 2 (File I/O)

1. **Varianta A: Sekvenční streamování – Velký soubor (1× 100 MB)**
   - Testuje hrubou propustnost I/O a chování paměti při streamování.
   - **Node.js:** Nativní proudy (`node:fs` – `createWriteStream`, `createReadStream`) s 64KB bloky a řízením zpětného tlaku (`drain`).
   - **Deno:** Nativní `Deno.open()` a standardní Web Streams API (`file.writable.getWriter()`, `file.readable.getReader()`) s 64KB bloky a `writer.ready` backpressure.
2. **Varianta B: Systémová režie – Malé soubory (1 000× 4 KB)**
   - Testuje režii systémových volání OS, metadata souborového systému a zatížení interního I/O thread poolu (`libuv` v Node.js vs. Tokio/Rust v Deno).
   - **Node.js:** Paralelní `Promise.all` s `writeFile` a `readFile` z `node:fs/promises`.
   - **Deno:** Paralelní `Promise.all` s `Deno.writeFile` a `Deno.readFile`.

---

## ⌨️ Příkazy pro spuštění z terminálu

Detailní přehled příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/COMMANDS.md).

### Node.js

```bash
# Plné měření (10 warmup + 30 iterací)
npm run bench:file-io

# Rychlý ověřovací běh (2 warmup + 5 iterací)
npm run bench:file-io:quick
```

### Deno

```bash
# Plné měření přes npm skript (10 warmup + 30 iterací)
npm run bench:file-io:deno

# Rychlý ověřovací běh přes npm skript (2 warmup + 5 iterací)
npm run bench:file-io:deno:quick

# Nebo přímé spuštění přes deno CLI:
deno run --allow-read --allow-write --allow-sys scenarios/02-file-io/deno.ts
```

---

## 📊 Výstupní data

Výsledky se ukládají ve formátu JSON do adresáře `results/`:

- **Node.js:**
  - `results/file_io_raw_node.json`
  - `results/file_io_summary_node.json`
- **Deno:**
  - `results/file_io_raw_deno.json`
  - `results/file_io_summary_deno.json`
