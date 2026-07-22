// ── スクリプトプロパティに設定するキー ──────────────────────────────
// SUPABASE_URL         : https://xxx.supabase.co
// SUPABASE_SERVICE_KEY : Supabase の service_role キー（RLS バイパス用）
// GAS_SECRET           : POS との共有シークレット（任意の文字列）
// DRIVE_FOLDER_ID      : スプレッドシートを置く Google Drive フォルダの ID
// STORE_ID             : この GAS が担当する店舗の ID（stores.id。例: 1 = 目黒店）
// STORE_LATITUDE       : 店舗の緯度（例: 35.6895）
// STORE_LONGITUDE      : 店舗の経度（例: 139.6917）

const PROPS = PropertiesService.getScriptProperties()
const SUPABASE_URL = PROPS.getProperty('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = PROPS.getProperty('SUPABASE_SERVICE_KEY')
const GAS_SECRET = PROPS.getProperty('GAS_SECRET')
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID')
const STORE_ID = PROPS.getProperty('STORE_ID') || '1'

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
const HEADERS = ['日付', '曜日（祝日）', '天気', '来客数', '組数', '売上', '現金', 'キャッシュレス', '割引', '経費', '経費枚数', '利益']
const WEATHER_COL = 3  // 天気は3列目（1-indexed）

// ── タイマートリガーから呼ばれる ──────────────────────────────────────
function syncFromSupabase() {
  var now = new Date()
  var year = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy')

  var unsynced = fetchUnsyncedPayments()

  // 先にシートを再構築し、成功してから同期済みにする
  rebuildAnnualSheet(year)

  // 年が替わった直後（1/1〜7）は前年シートも更新
  if (now.getMonth() === 0 && now.getDate() <= 7) {
    rebuildAnnualSheet(String(parseInt(year, 10) - 1))
  }

  if (unsynced.length > 0) {
    markSynced(unsynced.map(function(p) { return p.id }))
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

    // 先にシートを再構築し、成功してから同期済みにする
    // （途中失敗時に payments が「同期済み」で固定化して欠落するのを防ぐ）
    var now = new Date()
    var year = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy')
    rebuildAnnualSheet(year)

    if (now.getMonth() === 0 && now.getDate() <= 7) {
      rebuildAnnualSheet(String(parseInt(year, 10) - 1))
    }

    if (syncedIds.length > 0) markSynced(syncedIds)

    return respond({ syncedIds: syncedIds })
  } catch (err) {
    return respond({ error: err.toString() })
  }
}

// ── 年次シートを全再構築（1シートで1年分） ────────────────────────────
function rebuildAnnualSheet(year) {
  var allPayments = fetchPaymentsForYear(year)
  var expenseList = fetchExpensesForYear(year)
  Logger.log('[rebuild] year=%s payments=%s expenses=%s', year, allPayments.length, expenseList.length)

  var expenseMap = {}
  expenseList.forEach(function(e) { expenseMap[e.business_date] = e })

  var activePayments = allPayments.filter(function(p) { return !p.canceled_at })
  var byDay = groupBy(activePayments, function(p) { return p.business_date })

  var allDates = Object.keys(byDay)
  Object.keys(expenseMap).forEach(function(d) {
    if (allDates.indexOf(d) === -1) allDates.push(d)
  })
  if (allDates.length === 0) {
    Logger.log('[rebuild] 対象日なし → 書き込みスキップ')
    return
  }
  allDates.sort()

  var ss = getOrCreateSpreadsheet(year + '-01')
  var sheet = getOrCreateSheet(ss, '会計')
  Logger.log('[rebuild] 書き込み先 spreadsheet="%s" id=%s url=%s', ss.getName(), ss.getId(), ss.getUrl())

  // 天気をAPIで取得し、直近5日分はシートの既存入力をフォールバックとして使う
  var weatherFromApi = fetchWeatherForYear(year)
  var weatherFromSheet = readExistingWeather(sheet)

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
    var dateStr = toDateStr(date)
    // APIデータ優先、なければシートの既存値（直近で未取得の日）
    var weather = weatherFromApi[dateStr] || weatherFromSheet[dateStr] || ''

    allRows.push([
      dateStr,
      getDayStr(date),
      weather,
      totalGuests,
      dayPayments.length,
      totalSales, totalCash, totalCashless,
      totalDiscount,
      expenseAmt, expenseCount, profit
    ])
  })

  if (allRows.length === 0) return
  sheet.getRange(2, 1, allRows.length, HEADERS.length).setValues(allRows)
  Logger.log('[rebuild] %s 行を書き込み完了', allRows.length)
}

// ── 既存シートから天気データを読み取る（日付→天気のマップ） ──────────
function readExistingWeather(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow <= 1) return {}
  var data = sheet.getRange(2, 1, lastRow - 1, WEATHER_COL).getValues()
  var map = {}
  data.forEach(function(row) {
    var key = row[0]
    // Sheets が日付セルを Date 型で返す場合があるため M/D 文字列に正規化
    if (key instanceof Date) key = (key.getMonth() + 1) + '/' + key.getDate()
    if (key && row[2]) map[String(key)] = row[2]
  })
  return map
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

// ── 診断用: payments を無条件で数件取得してログ出力（手動実行） ──────
function debugPayments() {
  var url = SUPABASE_URL + '/rest/v1/payments?order=payment_datetime.desc&limit=5'
  var res = UrlFetchApp.fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
    muteHttpExceptions: true,
  })
  Logger.log('[debug] status=%s', res.getResponseCode())
  var data = JSON.parse(res.getContentText())
  if (!Array.isArray(data)) {
    Logger.log('[debug] 配列でない応答: %s', res.getContentText())
    return
  }
  Logger.log('[debug] 直近payments件数=%s', data.length)
  data.forEach(function(p, i) {
    Logger.log('[debug] #%s id=%s business_date="%s" canceled_at=%s total=%s',
      i, p.id, p.business_date, p.canceled_at, p.total_amount)
  })
}

// ── Supabase: 未同期 payments 取得 ───────────────────────────────────
function fetchUnsyncedPayments() {
  var res = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/payments?store_id=eq.' + STORE_ID + '&synced_to_sheet_at=is.null&canceled_at=is.null&order=payment_datetime.asc',
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

// ── Supabase: 指定年の全 payments 取得 ──────────────────────────────
function fetchPaymentsForYear(year) {
  var url = SUPABASE_URL + '/rest/v1/payments'
    + '?store_id=eq.' + STORE_ID
    + '&business_date=gte.' + year + '-01-01'
    + '&business_date=lte.' + year + '-12-31'
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
  if (!Array.isArray(data)) {
    Logger.log('[payments取得エラー] status=%s body=%s', res.getResponseCode(), res.getContentText())
    return []
  }
  return data
}

// ── Supabase: 指定年の daily_expenses 取得 ──────────────────────────
function fetchExpensesForYear(year) {
  var url = SUPABASE_URL + '/rest/v1/daily_expenses'
    + '?store_id=eq.' + STORE_ID
    + '&business_date=gte.' + year + '-01-01'
    + '&business_date=lte.' + year + '-12-31'
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

// ── Open-Meteo: 指定年の天気を取得（日付→天気文字列のマップ） ────────
// アーカイブAPIは約5日前までしか持たないため、
// 直近分（過去7日+今日）は予報APIの past_days で補完する
function fetchWeatherForYear(year) {
  var lat = PROPS.getProperty('STORE_LATITUDE') || '35.6895'
  var lng = PROPS.getProperty('STORE_LONGITUDE') || '139.6917'

  var result = {}

  // 年初〜5日前: アーカイブAPI
  var today = new Date()
  var cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() - 5)
  var startDateStr = year + '-01-01'
  var endDateStr = Utilities.formatDate(cutoff, 'Asia/Tokyo', 'yyyy-MM-dd')
  if (endDateStr >= startDateStr) {
    mergeWeatherFromApi(result, year,
      'https://archive-api.open-meteo.com/v1/archive'
      + '?latitude=' + lat
      + '&longitude=' + lng
      + '&start_date=' + startDateStr
      + '&end_date=' + endDateStr
      + '&daily=weathercode'
      + '&timezone=Asia%2FTokyo')
  }

  // 直近（過去7日+今日）: 予報API。アーカイブ未反映分を上書きで補完
  var thisYear = Utilities.formatDate(today, 'Asia/Tokyo', 'yyyy')
  if (year === thisYear) {
    mergeWeatherFromApi(result, year,
      'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + lat
      + '&longitude=' + lng
      + '&daily=weathercode&past_days=7&forecast_days=1'
      + '&timezone=Asia%2FTokyo')
  }

  return result
}

// 天気APIを叩いて result に「M/D → 天気」を追記する
function mergeWeatherFromApi(result, year, url) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true })
    var data = JSON.parse(res.getContentText())
    if (!data.daily || !data.daily.time) {
      Logger.log('[weather] APIエラー応答: %s', res.getContentText().slice(0, 200))
      return
    }
    data.daily.time.forEach(function(date, i) {
      if (date.slice(0, 4) !== String(year)) return  // 年またぎ分（1月頭のpast_days等）を除外
      var code = data.daily.weathercode[i]
      if (code === null || code === undefined) return
      var d = new Date(date + 'T00:00:00')
      var key = (d.getMonth() + 1) + '/' + d.getDate()
      result[key] = wmoToJa(code)
    })
  } catch (e) {
    Logger.log('[weather] 取得失敗: %s', e)
  }
}

// WMO 天気コード → 日本語
function wmoToJa(code) {
  if (code === 0)           return '快晴'
  if (code <= 2)            return '晴れ'
  if (code === 3)           return '曇り'
  if (code <= 49)           return '霧'
  if (code <= 59)           return '霧雨'
  if (code <= 67)           return '雨'
  if (code <= 77)           return '雪'
  if (code <= 82)           return 'にわか雨'
  if (code <= 99)           return '雷雨'
  return ''
}

// ── ユーティリティ ───────────────────────────────────────────────────

function groupBy(arr, keyFn) {
  return arr.reduce(function(acc, item) {
    var key = keyFn(item)
    ;(acc[key] = acc[key] || []).push(item)
    return acc
  }, {})
}

// 日付列: M/D 形式
function toDateStr(businessDate) {
  var d = new Date(businessDate + 'T00:00:00')
  return (d.getMonth() + 1) + '/' + d.getDate()
}

// 曜日列: 曜日＋祝日判定（Google カレンダーの日本の祝日を参照）
function getDayStr(businessDate) {
  var d = new Date(businessDate + 'T00:00:00')
  var day = DAYS_JA[d.getDay()]
  try {
    var cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com')
    var events = cal.getEventsForDay(d)
    if (events.length > 0) return day + '（祝）'
  } catch (e) {}
  return day
}

function formatJstTime(isoString) {
  return Utilities.formatDate(new Date(isoString), 'Asia/Tokyo', 'HH:mm')
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
