<!-- 发版维护提醒：每次发版必改两处——① manifest.json 的 version 递增；② versions.json 追加一行 "新版本": "minAppVersion"。tag 必须与 manifest version 完全一致（不带 v）。详见 E:\Obsidian\vault002-outup-others\tools\Obsidian 社区插件上架流程.md -->

# Dice Table

Roll a random result set from Markdown dice tables and save it with one click.

Dice Table is a lightweight randomizer for Obsidian. You write "dice tables" as ordinary Markdown notes; the plugin reads them, rolls one random entry per section, and — if you like the result — saves it as a new note or exports it as a PNG/JPG image.

**Engine and data are fully separated.** The plugin knows nothing about any specific table. It only understands three things:

- `#` (H1) — the dice name
- `##` (H2) — a pool (one thing to roll)
- `-` — a face (one possible result)

Any Markdown file that follows this shape is a dice table. Write 5 pools and you roll 5 items; write 20 and you roll 20. No per-table configuration needed.

## Features

- **Roll everything at once** — one click rolls every pool in the selected table.
- **Re-roll a single pool** — each result row has a small re-roll button that re-rolls only that pool.
- **Multi-select pools** — write `## Loot ×3` to roll 3 non-repeating entries from one pool. Also accepts `*3`, `x3`, `X3`. Append `重复`, `repeat` or `r` (no space) to allow repeats, e.g. `## Loot ×3repeat`.
- **Multiple dice per file** — a file may contain several H1 dice; pick one from a dropdown.
- **Auto-refresh** — new, renamed or deleted table files in the dice folder are picked up automatically, no reload needed.
- **Save with one click** — results are saved using your own naming template, e.g. `{H1}_{YYYYMMDD-HHmm}`. Variables: `{H1}`, `{H2}`, `{H2:2}`, `{YYYY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}`, `{WW}` and combos like `{YYYYMMDD-HHmm}`. Illegal filename characters are replaced automatically; name collisions get a numeric suffix.
- **Image export** — set the save format to PNG or JPG and the result is rendered as a clean 2x result card. Colors follow your theme at export time (dark mode exports a dark card).
- **Follows your theme** — the UI and the default card style use Obsidian's theme variables, so light/dark and custom themes just work.
- **Open where you want** — the dice view can open in a main tab or in the sidebar (configurable in settings).

## Installation

1. Open **Settings → Community plugins** in Obsidian.
2. Search for **Dice Table** and install it, or install manually from a release (copy `main.js`, `manifest.json`, `styles.css` into `<vault>/.obsidian/plugins/dice-table/`).
3. Enable the plugin.

## Usage

1. Open settings and point **Dice folder** at a folder containing your dice tables (a folder picker suggests existing folders; new paths are created automatically when saving).
2. Set **Save folder** and, optionally, the **naming template** and **save format** (Markdown / PNG / JPG).
3. Click the dice icon in the left ribbon. Pick a table, roll, re-roll single pools as you like.
4. Happy with the result? Hit **Save** — the file (or image) lands in your save folder with your naming template.

### Dice table example

```markdown
# Archaeology Site

## Terrain
- Sunken temple
- Wind-carved cliffs

## Loot ×2
- Bronze idol
- Cracked amphora
```

## Network access

None. Dice Table makes no network requests and collects no data.

## 中文说明

**骰表（Dice Table）** 是一个 Obsidian 随机结果插件：把骰表写成普通 Markdown 笔记（H1＝骰子名，H2＝要摇的项，横杠条目＝可摇的面），插件从每个项里随机抽一条组成一组结果，满意就一键保存为笔记或导出 PNG/JPG 图片。引擎与数据彻底分离：插件不认识任何具体骰表，只认 H1/H2/横杠结构；表里有几个 H2 就摇几项。支持单项重摇、`×N` 多选（`## 战利品 ×3`，默认不重复，`×3重复`/`×3repeat` 允许重复）、一个文件多个骰子、自定义命名模板（如 `{H1}_{YYYYMMDD-HHmm}`）、导出图片时自动固化当前主题色。插件不发起任何网络请求。

## License

[MIT](LICENSE)
