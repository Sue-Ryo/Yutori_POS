// ── スクリプトプロパティに設定するキー ──────────────────────────────
// SUPABASE_URL       : https://xxx.supabase.co
// SUPABASE_SERVICE_KEY : Supabase の service_role キー（RLS バイパス用）
// GAS_SECRET         : POS との共有シークレット（任意の文字列）
// DRIVE_FOLDER_ID    : スプレッドシートを置く Google Drive フォルダの ID

const PROPS = PropertiesService.getScriptProperties()
const SUPABASE_URL = PROPS.getProperty('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = PROPS.getProperty('SUPABASE_SERVICE_KEY')
const GAS_SECRET = PROPS.getProperty('GAS_SECRET')
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID')

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
const HEADERS = ['No.', '顧客名/席名', '人数', '入店時間', '会計時間', '滞在(分)', '合計(税込)', '支払方法', '割引額', '消費税']

// ── タイマートリガーから呼ばれる（Supabase を直接読む） ──────────────
function syncFromSupabase() {
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
  var payments = JSON.parse(res.getContentText())
  if (!Array.isArray(payments) || payments.length === 0) return

  // snake_case → camelCase に正規化
  var normalized = payments.map(normalizePayment)
  var syncedIds = syncPaymentsToSheets(normalized)

  if (syncedIds.length > 0) markSynced(syncedIds)
}

// ── POS の手動ボタンから HTTP POST で呼ばれる ────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents)

    if (body.secret !== GAS_SECRET) {
      return respond({ error: 'Unauthorized' })
    }

    var payments = (body.payments || [])
      .filter(function(p) { return !p.syncedToSheetAt && !p.canceledAt })
      .map(normalizePayment)

    if (payments.length === 0) {
      return respond({ syncedIds: [] })
    }

    var syncedIds = syncPaymentsToSheets(payments)
    return respond({ syncedIds: syncedIds })

  } catch (err) {
    return respond({ error: err.toString() })
  }
}

// ── メイン同期処理 ───────────────────────────────────────────────────
function syncPaymentsToSheets(payments) {
  var byMonth = groupBy(payments, function(p) {
    return p.businessDate.slice(0, 7)
  })

  var syncedIds = []

  Object.keys(byMonth).forEach(function(ym) {
    var ss = getOrCreateSpreadsheet(ym)
    var byDay = groupBy(byMonth[ym], function(p) { return p.businessDate })

    Object.keys(byDay).sort().forEach(function(date) {
      var dayPayments = byDay[date].sort(function(a, b) {
        return new Date(a.paymentDatetime) - new Date(b.paymentDatetime)
      })

      var sheetTitle = toSheetTitle(date)
      var sheet = getOrCreateSheet(ss, sheetTitle)
      var existingRows = Math.max(0, sheet.getLastRow() - 1)

      var rows = dayPayments.map(function(p, i) {
        var startTime = p.sessionStartedAt ? formatTime(new Date(p.sessionStartedAt)) : ''
        var endTime = formatTime(new Date(p.paymentDatetime))
        var stayMins = p.sessionStartedAt
          ? Math.round((new Date(p.paymentDatetime) - new Date(p.sessionStartedAt)) / 60000)
          : ''
        var payMethod = (p.cashlessAmount > 0 && p.cashAmount === 0) ? 'キャッシュレス' : '現金'

        return [
          existingRows + i + 1,
          p.customerName || '',
          p.guestCount,
          startTime,
          endTime,
          stayMins,
          p.totalAmount,
          payMethod,
          p.discountAmount,
          p.taxAmount,
        ]
      })

      if (rows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows)
      }

      syncedIds = syncedIds.concat(dayPayments.map(function(p) { return p.id }))
    })
  })

  return syncedIds
}

// ── スプレッドシート取得 or 作成 ─────────────────────────────────────
function getOrCreateSpreadsheet(yearMonth) {
  var parts = yearMonth.split('-')
  var title = parts[0] + '年' + parseInt(parts[1]) + '月 会計データ'
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID)
  var files = folder.getFilesByName(title)
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next())
  }
  var ss = SpreadsheetApp.create(title)
  DriveApp.getFileById(ss.getId()).moveTo(folder)
  return ss
}

// ── シート取得 or 作成（ヘッダー付き） ──────────────────────────────
function getOrCreateSheet(ss, title) {
  var sheet = ss.getSheetByName(title)
  if (!sheet) {
    sheet = ss.insertSheet(title)
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    sheet.setFrozenRows(1)
    // ヘッダー行を太字・背景色に
    var headerRange = sheet.getRange(1, 1, 1, HEADERS.length)
    headerRange.setFontWeight('bold')
    headerRange.setBackground('#4a86e8')
    headerRange.setFontColor('#ffffff')
  }
  return sheet
}

// ── Supabase の synced_to_sheet_at を更新（タイマー専用） ────────────
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
    id: p.id,
    businessDate: p.business_date || p.businessDate || '',
    paymentDatetime: p.payment_datetime || p.paymentDatetime,
    sessionStartedAt: p.session_started_at || p.sessionStartedAt || null,
    customerName: p.customer_name || p.customerName || '',
    guestCount: p.guest_count || p.guestCount || 1,
    totalAmount: p.total_amount || p.totalAmount || 0,
    cashAmount: p.cash_amount || p.cashAmount || 0,
    cashlessAmount: p.cashless_amount || p.cashlessAmount || 0,
    discountAmount: p.discount_amount || p.discountAmount || 0,
    taxAmount: p.tax_amount || p.taxAmount || 0,
    syncedToSheetAt: p.synced_to_sheet_at || p.syncedToSheetAt || null,
    canceledAt: p.canceled_at || p.canceledAt || null,
  }
}

function groupBy(arr, keyFn) {
  return arr.reduce(function(acc, item) {
    var key = keyFn(item)
    ;(acc[key] = acc[key] || []).push(item)
    return acc
  }, {})
}

function toSheetTitle(businessDate) {
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
