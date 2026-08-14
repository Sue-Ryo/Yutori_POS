import { readFileSync, writeFileSync } from "node:fs"

const body = readFileSync("body.html", "utf8")

// marked の CLI は見出しに id を振らないため、目次リンク用に GitHub 互換の slug を付ける
const slug = (text) =>
  text
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")

const withIds = body
  // 文書タイトルは表紙で出すので、本文先頭の h1 は落とす
  .replace(/^\s*<h1>.*?<\/h1>\s*/s, "")
  .replace(
    /<(h[123])>(.*?)<\/\1>/g,
    (_m, tag, inner) => `<${tag} id="${slug(inner)}">${inner}</${tag}>`,
  )

const today = new Date().toLocaleDateString("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
})

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>yutori POS 操作マニュアル</title>
<style>
  @page {
    size: A4;
    /* 表の説明列が細かく折り返さないよう、左右は詰めて版面を広く取る */
    margin: 15mm 11mm 16mm;
  }

  :root {
    --ink: #16181a;
    --ink-soft: #4a5054;
    --ink-faint: #7b8288;
    --line: #d9dee0;
    --line-soft: #eceff0;
    --accent: #0f7a5f;
    --accent-soft: #e8f4f0;
    --amber: #a6741a;
    --amber-soft: #fdf5e6;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: "Yu Gothic", YuGothic, "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
    font-size: 10pt;
    line-height: 1.75;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── 表紙 ── */
  .cover {
    border-bottom: 3px solid var(--accent);
    padding-bottom: 10mm;
    margin-bottom: 8mm;
  }
  .cover .kicker {
    font-size: 8pt;
    letter-spacing: 0.22em;
    color: var(--accent);
    font-weight: 700;
    margin: 0 0 3mm;
  }
  .cover .date {
    font-size: 8.5pt;
    color: var(--ink-faint);
    margin: 2mm 0 0;
  }

  h1 {
    font-size: 22pt;
    line-height: 1.25;
    letter-spacing: -0.02em;
    margin: 0;
    font-weight: 700;
  }

  h2 {
    font-size: 14pt;
    letter-spacing: -0.01em;
    margin: 9mm 0 3mm;
    padding: 0 0 2mm;
    border-bottom: 1.5px solid var(--line);
    font-weight: 700;
    break-after: avoid;
    page-break-after: avoid;
  }

  h3 {
    font-size: 11pt;
    margin: 6mm 0 2mm;
    font-weight: 700;
    color: var(--accent);
    break-after: avoid;
    page-break-after: avoid;
  }

  p { margin: 0 0 2.5mm; }

  ul, ol { margin: 0 0 3mm; padding-left: 5.5mm; }
  li { margin-bottom: 1.2mm; }
  li::marker { color: var(--ink-faint); }
  ol > li::marker { color: var(--accent); font-weight: 700; }

  strong { font-weight: 700; }

  a { color: var(--ink); text-decoration: none; }

  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 9pt;
    background: #f2f4f5;
    border: 1px solid var(--line-soft);
    border-radius: 3px;
    padding: 0.5mm 1.2mm;
  }

  hr {
    border: 0;
    border-top: 1px solid var(--line-soft);
    margin: 6mm 0;
  }

  /* ── 表 ── */
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 4mm;
    font-size: 9pt;
    line-height: 1.6;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 1.4mm 2mm;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: var(--accent-soft);
    font-weight: 700;
    font-size: 8.6pt;
  }
  /* 1列目は項目名。折り返さずに必要なぶんだけ幅を取り、残りを説明に回す */
  td:first-child, th:first-child {
    font-weight: 700;
    white-space: nowrap;
    width: 1%;
  }
  td:first-child { color: var(--ink); }

  /* ── 補足（引用） ── */
  blockquote {
    margin: 0 0 4mm;
    padding: 2.5mm 4mm;
    background: var(--amber-soft);
    border-left: 3px solid var(--amber);
    color: var(--ink-soft);
    font-size: 9.4pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }

  /* 章ごとに改ページ。紙で引くときに章の頭が探しやすい */
  h2 { break-before: page; page-break-before: always; }
  /* 表紙直後の目次だけは続けて置く */
  .cover + h2 { break-before: auto; page-break-before: auto; }
</style>
</head>
<body>
<header class="cover">
  <p class="kicker">YUTORI POS / OPERATION MANUAL</p>
  <h1>yutori POS 操作マニュアル</h1>
  <p class="date">${today} 版</p>
</header>
${withIds}
</body>
</html>
`

writeFileSync("manual-print.html", html, "utf8")
console.log("wrote manual-print.html", html.length, "bytes")
