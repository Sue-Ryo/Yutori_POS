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
const HEADERS = ['日付', '来客数', '組数', '売上', '現金', 'キャッシュレス', '割引', '経費', '経費枚数', '利益']

// ── タイマートリガーから呼ばれる ──────────────────────────────────────
function syncFromSupabase() {
  var now = new Date()
  var ym = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM')

  var unsynced = fetchUnsyncedPayments()
  if (unsynced.length > 0) {
    markSynced(unsynced.map(function(p) { return p.id }))
  }

  rebuildAggregateRows(ym)

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

    var payments = body.payments || []
    var syncedIds = payments
      .filter(function(p) { return !p.canceledAt && !p.canceled_at })
      .map(function(p) { return p.id })

    if (syncedIds.length > 0) markSynced(syncedIds)

    var now = new Date()
    var ym = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM')
    rebuildAggregateRows(ym)

    if (now.getDate() <= 7) {
      var prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      var prevYm = Utilities.formatDate(prevDate, 'Asia/Tokyo', 'yyyy-MM')
      rebuildAggregateRows(prevYm)
    }

    return respond({ syncedIds: syncedIds })
  } catch (err) {
    return respond({ error: err.toString() })
  }
}

// ── 月次シートを全再構築（日付ヘッダー行 + 明細行） ──────────────────
function rebuildAggregateRows(yearMonth) {
  var monthNum = parseInt(yearMonth.slice(5, 7), 10)
  var allPayments = fetchPaymentsForMonth(yearMonth)
  var expenseList = fetchExpensesForMonth(yearMonth)

  var expenseMap = {}
  expenseList.forEach(function(e) { expenseMap[e.business_date] = e })

  var activePayments = allPayments.filter(function(p) { return !p.canceled_at })
  var byDay = groupBy(activePayments, function(p) { return p.business_date })

  var allDates = Object.keys(byDay)
  Object.keys(expenseMap).forEach(function(d) {
    if (allDates.indexOf(d) === -1) allDates.push(d)
  })
  if (allDates.length === 0) return
  allDates.sort()

  var ss = getOrCreateSpreadsheet(yearMonth)
  var sheet = getOrCreateSheet(ss, monthNum + '月')

  // データ行をクリアして再構築
  var lastRow = sheet.getLastRow()
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1)

  var allRows = []

  allDates.forEach(function(date) {
    var dayPayments = byDay[date] || []
    var expense = expenseMap[date] || null

    var totalSales    = dayPayments.reduce(function(s, p) { return s + (p.total_amount    || 0) }, 0)
    var totalCash     = dayPayments.reduce(function(s, p) { return s + (p.cash_amount     || 0) }, 0)
    var totalCashless = dayPayments.reduce(function(s, p) { return s + (p.cashless_amount || 0) }, 0)
    var totalGuests   = dayPayments.reduce(function(s, p) { return s + (p.guest_count     || 0) }, 0)
    var totalDiscount = dayPayments.reduce(function(s, p) { return s + (p.discount_amount || 0) }, 0)
    var expenseAmt    = expense ? (expense.amount        || 0) : 0
    var expenseCount  = expense ? (expense.receipt_count || 0) : 0
    var profit = totalSales - expenseAmt

    allRows.push([
      toDateDisplay(date),
      totalGuests,
      dayPayments.length,
      totalSales, totalCash, totalCashless,
      totalDiscount,
      expenseAmt, expenseCount, profit
    ])
  })

  if (allRows.length === 0) return
  sheet.getRange(2, 1, allRows.length, HEADERS.length).setValues(allRows)
}

// ── スプレッドシート取得 or 作成（年次単位） ─────────────────────────
function getOrCreateSpreadsheet(yearMonth) {
  var year  = yearMonth.slice(0, 4)
  var title = year + '年 会計'
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID)
  var files = folder.getFilesByName(title)
  if (files.hasNext()) return SpreadsheetApp.open(files.next())
  var ss = SpreadsheetApp.create(title)
  DriveApp.getFileById(ss.getId()).moveTo(folder)
  return ss
}

// ── シート取得 or 作成（ヘッダー行を常に最新化） ─────────────────────
function getOrCreateSheet(ss, title) {
  var sheet = ss.getSheetByName(title)
  if (!sheet) {
    sheet = ss.insertSheet(title)
    sheet.setFrozenRows(1)
  }
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length)
  headerRange.setValues([HEADERS])
  headerRange.setFontWeight('bold')
  headerRange.setBackground('#4a86e8')
  headerRange.setFontColor('#ffffff')
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
  var url = SUPABASE_URL + '/rest/v1/payments'
    + '?business_date=gte.' + yearMonth + '-01'
    + '&business_date=lte.' + yearMonth + '-31'
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
  var url = SUPABASE_URL + '/rest/v1/daily_expenses'
    + '?business_date=gte.' + yearMonth + '-01'
    + '&business_date=lte.' + yearMonth + '-31'
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

function formatJstTime(isoString) {
  return Utilities.formatDate(new Date(isoString), 'Asia/Tokyo', 'HH:mm')
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
