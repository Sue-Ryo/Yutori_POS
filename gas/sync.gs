// ── スクリプトプロパティに設定するキー ──────────────────────────────
// SUPABASE_URL         : https://xxx.supabase.co
// SUPABASE_SERVICE_KEY : Supabase の service_role キー（RLS バイパス用）
// GAS_SECRET           : POS との共有シークレット（任意の文字列）
// DRIVE_FOLDER_ID      : スプレッドシートを置く Google Drive フォルダの ID

const PROPS = PropertiesService.getScriptProperties()
const SUPABASE_URL = PROPS.getProperty('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = PROPS.getProperty('SUPABASE_SERVICE_KEY')
const GAS_SECRET = PROPS.getProperty('GAS_SECRET')
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID')

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

// ハイブリッド形式ヘッダー（集計行・明細行で共用）
const HYBRID_HEADERS = [
  '種別', '日付/顧客名', '人数', '入店時間', '会計時間', '滞在(分)',
  '金額', '現金', 'キャッシュレス', '支払方法', '割引', '消費税',
  '経費', '経費枚数', '利益',
]

// ── タイマートリガーから呼ばれる ──────────────────────────────────────
function syncFromSupabase() {
  // 1. 未同期 payments → 明細行書き込み
  var unsyncedPayments = fetchUnsyncedPayments()
  if (unsyncedPayments.length > 0) {
    var normalized = unsyncedPayments.map(normalizePayment)
    var syncedIds = writeDetailRows(normalized)
    if (syncedIds.length > 0) markSynced(syncedIds)
  }

  // 2. 今月の集計行を再構築（経費含む）
  var now = new Date()
  var ym = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM')
  rebuildAggregateRows(ym)

  // 月初め1〜7日は先月分も更新（月をまたいだ経費編集に対応）
  if (now.getDate() <= 7) {
    var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    var prevYm = Utilities.formatDate(prevDate, 'Asia/Tokyo', 'yyyy-MM')
    rebuildAggregateRows(prevYm)
  }
}

// ── POS の手動ボタンから HTTP POST で呼ばれる ────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents)
    if (body.secret !== GAS_SECRET) return respond({ error: 'Unauthorized' })

    var payments = (body.payments || [])
      .filter(function(p) { return !p.syncedToSheetAt && !p.canceledAt })
      .map(normalizePayment)

    var syncedIds = []
    if (payments.length > 0) {
      syncedIds = writeDetailRows(payments)
    }

    // 集計行も更新（Supabase からデータ取得して再構築）
    var now = new Date()
    var ym = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM')
    rebuildAggregateRows(ym)

    return respond({ syncedIds: syncedIds })
  } catch (err) {
    return respond({ error: err.toString() })
  }
}

// ── 明細行の書き込み ─────────────────────────────────────────────────
// 未同期の payments を受け取り、年次SS・月次タブに明細行として追記する
function writeDetailRows(payments) {
  var byYear = groupBy(payments, function(p) { return p.businessDate.slice(0, 4) })
  var syncedIds = []

  Object.keys(byYear).forEach(function(year) {
    var ss = getOrCreateSpreadsheet(year)
    var yearPayments = byYear[year]
    var byMonth = groupBy(yearPayments, function(p) {
      return parseInt(p.businessDate.slice(5, 7), 10)
    })

    Object.keys(byMonth).sort(function(a, b) { return a - b }).forEach(function(monthNum) {
      var sheet = getOrCreateSheet(ss, monthNum + '月')
      var monthPayments = byMonth[monthNum].sort(function(a, b) {
        return new Date(a.paymentDatetime) - new Date(b.paymentDatetime)
      })

      var rows = monthPayments.map(function(p) { return makeDetailRow(p) })
      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HYBRID_HEADERS.length).setValues(rows)
      }

      syncedIds = syncedIds.concat(monthPayments.map(function(p) { return p.id }))
    })
  })

  return syncedIds
}

// ── 集計行の再構築（指定年月） ────────────────────────────────────────
// Supabase から該当月の全データを取得し、各日の集計行を upsert する
function rebuildAggregateRows(yearMonth) {
  var year = yearMonth.slice(0, 4)
  var monthNum = parseInt(yearMonth.slice(5, 7), 10)

  // 全 payments（キャンセル除く）を取得して日別集計
  var allPayments = fetchPaymentsForMonth(yearMonth)
  var byDay = groupBy(allPayments, function(p) { return p.business_date })

  // daily_expenses を取得して日付 → レコードのマップ作成
  var expenses = fetchExpensesForMonth(yearMonth)
  var expenseMap = {}
  expenses.forEach(function(e) { expenseMap[e.business_date] = e })

  // 支払あり・経費あり 両方の日付を対象にする
  var allDates = Object.keys(byDay)
  Object.keys(expenseMap).forEach(function(d) {
    if (allDates.indexOf(d) === -1) allDates.push(d)
  })

  if (allDates.length === 0) return

  var ss = getOrCreateSpreadsheet(year)
  var sheet = getOrCreateSheet(ss, monthNum + '月')

  allDates.sort().forEach(function(date) {
    var dayPayments = byDay[date] || []
    var payAgg = {
      totalAmount:    dayPayments.reduce(function(s, p) { return s + (p.total_amount   || 0) }, 0),
      cashAmount:     dayPayments.reduce(function(s, p) { return s + (p.cash_amount    || 0) }, 0),
      cashlessAmount: dayPayments.reduce(function(s, p) { return s + (p.cashless_amount|| 0) }, 0),
      guestCount:     dayPayments.reduce(function(s, p) { return s + (p.guest_count    || 0) }, 0),
      groupCount:     dayPayments.length,
      discountAmount: dayPayments.reduce(function(s, p) { return s + (p.discount_amount|| 0) }, 0),
      taxAmount:      dayPayments.reduce(function(s, p) { return s + (p.tax_amount     || 0) }, 0),
    }
    var expense = expenseMap[date] || null
    upsertAggregateRow(sheet, date, payAgg, expense)
  })
}

// ── 集計行の upsert ───────────────────────────────────────────────────
// 行の種別列マーカー: ★YYYY-MM-DD（検索・ソートに使用）
function upsertAggregateRow(sheet, businessDate, payAgg, expense) {
  var marker = '★' + businessDate
  var dateDisplay = toDateDisplay(businessDate)

  var expenseAmount = expense ? expense.amount         : ''
  var receiptCount  = expense ? expense.receipt_count  : ''
  var profit        = expense ? (payAgg.totalAmount - expense.amount) : ''

  var rowData = [
    marker,
    dateDisplay,
    payAgg.guestCount + '名 / ' + payAgg.groupCount + '組',
    '', '', '',
    payAgg.totalAmount,
    payAgg.cashAmount,
    payAgg.cashlessAmount,
    '',
    payAgg.discountAmount,
    payAgg.taxAmount,
    expenseAmount,
    receiptCount,
    profit,
  ]

  // 既存の集計行を検索して更新、なければ挿入
  var found = sheet.createTextFinder(marker).matchEntireCell(true).findAll()
  if (found.length > 0) {
    var targetRow = found[0].getRow()
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData])
  } else {
    var insertPos = findInsertPosition(sheet, businessDate)
    if (insertPos > 0) {
      sheet.insertRowBefore(insertPos)
      sheet.getRange(insertPos, 1, 1, rowData.length).setValues([rowData])
      applyAggregateStyle(sheet.getRange(insertPos, 1, 1, rowData.length))
    } else {
      sheet.appendRow(rowData)
      applyAggregateStyle(sheet.getRange(sheet.getLastRow(), 1, 1, rowData.length))
    }
  }
}

// 集計行のスタイル（太字・背景色）
function applyAggregateStyle(range) {
  range.setBackground('#e8f0fe').setFontWeight('bold')
}

// 指定日付より後の最初の集計行の行番号を返す（なければ -1）
function findInsertPosition(sheet, businessDate) {
  var lastRow = sheet.getLastRow()
  if (lastRow <= 1) return -1
  var col1 = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
  for (var i = 0; i < col1.length; i++) {
    var cell = col1[i][0].toString()
    if (cell.startsWith('★') && cell.slice(1) > businessDate) {
      return i + 2
    }
  }
  return -1
}

// ── 明細行の生成 ─────────────────────────────────────────────────────
function makeDetailRow(p) {
  var startTime = p.sessionStartedAt ? formatTime(new Date(p.sessionStartedAt)) : ''
  var endTime   = formatTime(new Date(p.paymentDatetime))
  var stayMins  = p.sessionStartedAt
    ? Math.round((new Date(p.paymentDatetime) - new Date(p.sessionStartedAt)) / 60000)
    : ''
  var payMethod = (p.cashlessAmount > 0 && p.cashAmount === 0) ? 'キャッシュレス' : '現金'

  return [
    '',                    // 種別（明細は空白）
    p.customerName || '',  // 日付/顧客名
    p.guestCount,          // 人数
    startTime,             // 入店時間
    endTime,               // 会計時間
    stayMins,              // 滞在(分)
    p.totalAmount,         // 金額
    p.cashAmount,          // 現金
    p.cashlessAmount,      // キャッシュレス
    payMethod,             // 支払方法
    p.discountAmount,      // 割引
    p.taxAmount,           // 消費税
    '', '', '',            // 経費・経費枚数・利益（明細は空白）
  ]
}

// ── スプレッドシート取得 or 作成（年次） ─────────────────────────────
function getOrCreateSpreadsheet(year) {
  var title = year + '年 会計データ'
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID)
  var files = folder.getFilesByName(title)
  if (files.hasNext()) return SpreadsheetApp.open(files.next())
  var ss = SpreadsheetApp.create(title)
  DriveApp.getFileById(ss.getId()).moveTo(folder)
  return ss
}

// ── シート取得 or 作成（月次タブ・ヘッダー付き） ─────────────────────
function getOrCreateSheet(ss, title) {
  var sheet = ss.getSheetByName(title)
  if (!sheet) {
    sheet = ss.insertSheet(title)
    var headerRange = sheet.getRange(1, 1, 1, HYBRID_HEADERS.length)
    headerRange.setValues([HYBRID_HEADERS])
    headerRange.setFontWeight('bold')
    headerRange.setBackground('#4a86e8')
    headerRange.setFontColor('#ffffff')
    sheet.setFrozenRows(1)
  }
  return sheet
}

// ── Supabase: 未同期 payments 取得 ───────────────────────────────────
function fetchUnsyncedPayments() {
  var res = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/payments?synced_to_sheet_at=is.null&canceled_at=is.null&order=payment_datetime.asc',
    {
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      },
      muteHttpExceptions: true,
    }
  )
  var data = JSON.parse(res.getContentText())
  return Array.isArray(data) ? data : []
}

// ── Supabase: 指定月の全 payments 取得（キャンセル除く） ─────────────
function fetchPaymentsForMonth(yearMonth) {
  var startDate = yearMonth + '-01'
  var endDate   = yearMonth + '-31'
  var url = SUPABASE_URL + '/rest/v1/payments'
    + '?business_date=gte.' + startDate
    + '&business_date=lte.' + endDate
    + '&canceled_at=is.null'
    + '&order=business_date.asc,payment_datetime.asc'
  var res = UrlFetchApp.fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
    muteHttpExceptions: true,
  })
  var data = JSON.parse(res.getContentText())
  return Array.isArray(data) ? data : []
}

// ── Supabase: 指定月の daily_expenses 取得 ──────────────────────────
function fetchExpensesForMonth(yearMonth) {
  var startDate = yearMonth + '-01'
  var endDate   = yearMonth + '-31'
  var url = SUPABASE_URL + '/rest/v1/daily_expenses'
    + '?business_date=gte.' + startDate
    + '&business_date=lte.' + endDate
  var res = UrlFetchApp.fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
    muteHttpExceptions: true,
  })
  var data = JSON.parse(res.getContentText())
  return Array.isArray(data) ? data : []
}

// ── Supabase: synced_to_sheet_at を更新 ──────────────────────────────
function markSynced(ids) {
  var now = new Date().toISOString()
  UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/payments?id=in.(' + ids.join(',') + ')',
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      payload: JSON.stringify({ synced_to_sheet_at: now }),
      muteHttpExceptions: true,
    }
  )
}

// ── ユーティリティ ───────────────────────────────────────────────────

function normalizePayment(p) {
  return {
    id:               p.id,
    businessDate:     p.business_date      || p.businessDate      || '',
    paymentDatetime:  p.payment_datetime   || p.paymentDatetime,
    sessionStartedAt: p.session_started_at || p.sessionStartedAt  || null,
    customerName:     p.customer_name      || p.customerName      || '',
    guestCount:       p.guest_count        || p.guestCount        || 1,
    totalAmount:      p.total_amount       || p.totalAmount       || 0,
    cashAmount:       p.cash_amount        || p.cashAmount        || 0,
    cashlessAmount:   p.cashless_amount    || p.cashlessAmount    || 0,
    discountAmount:   p.discount_amount    || p.discountAmount    || 0,
    taxAmount:        p.tax_amount         || p.taxAmount         || 0,
    syncedToSheetAt:  p.synced_to_sheet_at || p.syncedToSheetAt   || null,
    canceledAt:       p.canceled_at        || p.canceledAt        || null,
  }
}

function groupBy(arr, keyFn) {
  return arr.reduce(function(acc, item) {
    var key = keyFn(item)
    ;(acc[key] = acc[key] || []).push(item)
    return acc
  }, {})
}

function toDateDisplay(businessDate) {
  var d = new Date(businessDate + 'T00:00:00')
  return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAYS_JA[d.getDay()] + ')'
}

function formatTime(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'HH:mm')
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
