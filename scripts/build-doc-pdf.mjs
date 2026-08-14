// 契約書・見積書の印刷用 HTML を作る。
//
//   npx -y marked --gfm -i docs/CONTRACT-DRAFT.md -o body.html
//   node scripts/build-doc-pdf.mjs body.html out.html "契約書"
//
// - 【　】（中身が空白のみ）は記入用の下線に置き換える
// - 【値】（中身があるもの）は括弧を外して確定値として表示する
// - 「記入前チェックリスト」以降と、先頭の社内向け注記は出力しない

import { readFileSync, writeFileSync } from "node:fs"

const [, , inPath, outPath, title] = process.argv
if (!inPath || !outPath || !title) {
  console.error("usage: node build-doc-pdf.mjs <body.html> <out.html> <title>")
  process.exit(1)
}

let body = readFileSync(inPath, "utf8")

// 表題から社内向けの注記（（ドラフト）（テンプレート））を外す
body = body.replace(
  /(<h1[^>]*>)([^<]*?)（(?:ドラフト|テンプレート)）(<\/h1>)/,
  "$1$2$3",
)

// 最初の blockquote は社内向けの注記（ドラフト警告・記入方法）なので落とす。
// 条文中の補足は2つ目以降に現れるため影響しない
body = body.replace(/<blockquote>[\s\S]*?<\/blockquote>\s*(<hr>\s*)?/, "")

// 「記入前チェックリスト」以降は社内用なので出力しない
const cutAt = body.search(/<h2[^>]*>\s*記入前チェックリスト/)
if (cutAt >= 0) {
  // 直前の <hr> ごと落とす
  const before = body.slice(0, cutAt)
  body = before.replace(/<hr>\s*$/, "")
}

// 【　】→ 記入欄、【値】→ 確定値
body = body.replace(/【([^】]*)】/g, (_m, inner) => {
  const isBlank = inner.trim() === "" || /^[\s　_]*$/.test(inner)
  if (!isBlank) return inner
  // 元の文字数に応じて記入欄の幅を決める（最低6文字ぶん）
  const width = Math.max(6, inner.length + 2)
  return `<span class="blank" style="min-width:${width}em"></span>`
})

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }

  :root {
    --ink: #111;
    --ink-soft: #444;
    --line: #999;
    --line-soft: #ccc;
    --band: #f0f2f1;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font-family: "Yu Mincho", YuMincho, "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 10pt;
    line-height: 1.85;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  h1 {
    font-size: 17pt;
    text-align: center;
    letter-spacing: 0.24em;
    margin: 0 0 10mm;
    padding-bottom: 4mm;
    border-bottom: 1.5px solid var(--ink);
    font-weight: 700;
  }

  /* 条見出し */
  h2 {
    font-size: 11pt;
    margin: 6mm 0 2mm;
    font-weight: 700;
    break-after: avoid;
    page-break-after: avoid;
  }

  /* 別紙見出し */
  h1 + h1, body > h1:not(:first-of-type) {
    break-before: page;
    page-break-before: always;
  }

  h3 {
    font-size: 10.5pt;
    margin: 4mm 0 1.5mm;
    font-weight: 700;
    break-after: avoid;
    page-break-after: avoid;
  }

  p { margin: 0 0 2mm; }

  ol, ul { margin: 0 0 2.5mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  ol > li { padding-left: 1mm; }

  strong { font-weight: 700; }

  hr { border: 0; border-top: 1px solid var(--line-soft); margin: 5mm 0; }

  /* 記入欄 */
  .blank {
    display: inline-block;
    border-bottom: 1px solid var(--ink);
    height: 1.15em;
    vertical-align: baseline;
    margin: 0 0.15em;
  }

  /* チェックボックス */
  body { font-feature-settings: "palt" 0; }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 3mm;
    font-size: 9.5pt;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 1.5mm 2mm;
    text-align: left;
    vertical-align: top;
  }
  th { background: var(--band); font-weight: 700; font-size: 9pt; }

  /* 署名欄・見積の右寄せブロック */
  div[align="right"] { text-align: right; }
  div[align="right"] p { margin: 0.5mm 0; }

  /* 署名欄のレイアウト（生の table を使っている箇所） */
  table[width], table:has(td[width]) { border: 0; }
  td[width] { border: 0; padding: 3mm 4mm 3mm 0; vertical-align: top; }

  blockquote {
    margin: 0 0 3mm;
    padding: 2mm 4mm;
    border-left: 2.5px solid var(--line);
    color: var(--ink-soft);
    font-size: 9.5pt;
  }
  blockquote p:last-child { margin-bottom: 0; }

  /* 金額など数字の並び */
  td { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
${body}
</body>
</html>
`

writeFileSync(outPath, html, "utf8")
console.log(`wrote ${outPath} (${html.length} chars)`)
