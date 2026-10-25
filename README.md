# Benchmarková sada pro analýzu běhových prostředí (Node.js, Deno, Bun)

Praktická část bakalářské práce: *„Sestavení benchmarkové sady pro analýzu běhových prostředí JavaScriptových aplikací (Node.js, Deno, Bun)“*.

Tento modul implementuje kompletní **Kategorii 2: Souborové I/O operace** pro všechna tři srovnávaná běhová prostředí: **Node.js**, **Deno** a **Bun**, včetně plné kontejnerizace pomocí **Dockeru**.

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

## 🐳 Izolované měření v Dockeru (lokálně i na VPS Hetzner)

Pro zajištění férových a reprodukovatelných podmínek jsou připraveny tři samostatné Dockerfiles ([docker/Dockerfile.node](file:///f:/unicorn/zdrojaky/BP/docker/Dockerfile.node), [docker/Dockerfile.deno](file:///f:/unicorn/zdrojaky/BP/docker/Dockerfile.deno), [docker/Dockerfile.bun](file:///f:/unicorn/zdrojaky/BP/docker/Dockerfile.bun)) postavené na shodném debianovém základu:
- **Limity zdrojů:** `--cpus=2 --memory=2g --memory-swap=2g` (vypnutý swap).
- **Objektivita souborového I/O:** Adresář `/app/temp` **není** připojen přes bind-mount z hostitelského OS, takže měření nezkresluje režie překladu souborového systému mezi Windows a Linuxem. Připojen je výhradně výstupní svazek `-v ./results:/app/results`.

```bash
# Sestavení a sekvenční spuštění všech 3 kontejnerů + křížové porovnání
npm run benchmark:docker

# Rychlý ověřovací běh v Dockeru (2 warmup + 5 iterací)
npm run benchmark:docker:quick

# Spuštění pouze jednoho kontejneru (např. Node.js)
npm run benchmark:docker:node
```

Detailní přehled všech příkazů naleznete v souboru [COMMANDS.md](file:///f:/unicorn/zdrojaky/BP/COMMANDS.md).
