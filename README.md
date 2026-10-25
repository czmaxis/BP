# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: *„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“*.

Tento modul implementuje kompletní **Kategorii 2: Souborové I/O operace** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**.

---

## 📋 Přehled modulů Kategorie 2 (File I/O)

1. **Varianta A: Sekvenční streamování – Velký soubor (1× 100 MB)**
   - Testuje hrubou propustnost I/O a chování paměti při streamování.
   - **Node.js:** Nativní proudy (`node:fs` – `createWriteStream`, `createReadStream`) s 64KB bloky a řízením zpětného tlaku (`drain`).
   - **Deno:** Nativní `Deno.open()` a Web Streams API (`file.writable.getWriter()`, `file.readable.getReader()`) s 64KB bloky.
   - **Bun:** Nativní `Bun.write(path, ReadableStream)` a `Bun.file(path).stream()` s 64KB bloky.
2. **Varianta B: Systémová režie – Malé soubory (1 000× 4 KB)**
   - Testuje režii systémových volání OS, metadata souborového systému a zatížení interního I/O thread poolu (`libuv` v Node.js, Tokio/Rust v Deno, Zig I/O v Bun).
   - **Node.js:** Paralelní `Promise.all` s `writeFile` a `readFile` z `node:fs/promises`.
   - **Deno:** Paralelní `Promise.all` s `Deno.writeFile` a `Deno.readFile`.
   - **Bun:** Paralelní `Promise.all` s `Bun.write()` a `Bun.file().arrayBuffer()`.

---

## ⌨️ Příkazy pro spuštění z terminálu

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/COMMANDS.md).

```bash
# 1. Node.js (10 warmup + 30 iterací)
npm run bench:file-io

# 2. Deno (10 warmup + 30 iterací)
npm run bench:file-io:deno

# 3. Bun (10 warmup + 30 iterací)
npm run bench:file-io:bun

# 4. Křížové porovnání všech 3 platforem v konzoli + export srovnávacího JSONu
npm run compare
```

---

## 📊 Výstupní data

Výsledky se ukládají ve formátu JSON do adresáře `results/`:
- **Node.js:** `results/file_io_raw_node.json`, `results/file_io_summary_node.json`
- **Deno:** `results/file_io_raw_deno.json`, `results/file_io_summary_deno.json`
- **Bun:** `results/file_io_raw_bun.json`, `results/file_io_summary_bun.json`
- **Sjednocené porovnání:** `results/file_io_comparison.json`
