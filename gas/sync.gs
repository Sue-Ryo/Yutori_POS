// ── スクリプトプロパティに設定するキー ──────────────────────────────
// SUPABASE_URL         : https://xxx.supabase.co
// SUPABASE_SERVICE_KEY : Supabase の service_role キー（RLS バイパス用）
// GAS_SECRET           : POS との共有シークレット（任意の文字列）
// DRIVE_FOLDER_ID      : スプレッドシートを置く Google Drive フォルダの ID
//
// ── 任意（未設定でも動く） ──────────────────────────────────────────
// STORE_IDS            : 対象店舗を絞る場合のみ。カンマ区切り（例: "1,4,5"）
//                        未設定なら stores テーブルの全店舗が対象
// STORE_COORDS_JSON    : 天気APIに使う店舗座標の上書き
//                        例: {"1":{"lat":"35.6339","lng":"139.7160"}}
//
// この GAS ひとつで全店舗を処理し、1つのスプレッドシート
// 「<年>年 会計」の中に店舗名のシートを1枚ずつ作って書き分ける。

const PROPS = PropertiesService.getScriptProperties()
const SUPABASE_URL = PROPS.getProperty('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = PROPS.getProperty('SUPABASE_SERVICE_KEY')
const GAS_SECRET = PROPS.getProperty('GAS_SECRET')
const DRIVE_FOLDER_ID = PROPS.getProperty('DRIVE_FOLDER_ID')

const DAYS_JA = ['日', '月', '火', '水', '木', '金', '土']
const HEADERS = ['年', '月', '日', '曜日（祝日）', '天気', '来客数', '組数', '新規来客数', '新規組数', '粗利', '現金', 'キャッシュレス', '割引', '経費', '経費枚数', '利益']
const DATE_COL = 1       // 年・月・日は1〜3列目（1-indexed）
const DATE_COL_COUNT = 3
const WEATHER_COL = 5    // 天気は5列目（1-indexed）
// 日付が1列（M/D）だった頃のレイアウト。既存シートの天気を引き継ぐときだけ使う
const LEGACY_WEATHER_COL = 3

// 天気APIに渡す店舗座標。STORE_COORDS_JSON で上書きできる
const DEFAULT_STORE_COORDS = {
  '1': { lat: '35.6339', lng: '139.7160' },  // 目黒店
  '4': { lat: '35.7778', lng: '139.7208' },  // 赤羽店
  '5': { lat: '35.6553', lng: '139.7570' },  // 浜松町店
}
const FALLBACK_COORDS = { lat: '35.6895', lng: '139.6917' }  // 座標未登録の店舗用

// stores が引けなかったときの保険。ここが使われるのは異常時のみ
const FALLBACK_STORES = [
  { id: '1', name: '目黒店' },
  { id: '4', name: '赤羽店' },
  { id: '5', name: '浜松町店' },
]

// 1店舗運用だった頃のシート名。初回だけ店舗名シートへ引き継ぐ
const LEGACY_SHEET_NAME = '会計'
const LEGACY_STORE_ID = '1'

// ── タイマートリガーから呼ばれる ──────────────────────────────────────
function syncFromSupabase() {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(5 * 60 * 1000)) {
    Logger.log('[sync] 別の実行が進行中のためスキップ')
    return
  }
  try {
    var now = new Date()
    var year = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy')

    var unsynced = fetchUnsyncedPayments()

    // 先にシートを再構築し、成功してから同期済みにする
    rebuildAllSheets(year)

    // 年が替わった直後（1/1〜7）は前年シートも更新
    if (now.getMonth() === 0 && now.getDate() <= 7) {
      rebuildAllSheets(String(parseInt(year, 10) - 1))
    }

    if (unsynced.length > 0) {
      markSynced(unsynced.map(function(p) { return p.id }))
    }
  } finally {
    lock.releaseLock()
  }
}

// ── POS の手動ボタンから HTTP POST で呼ばれる ────────────────────────
function doPost(e) {
  var lock = LockService.getScriptLock()
  if (!lock.tryLock(5 * 60 * 1000)) {
    return respond({ error: '別の同期が実行中です。少し待ってからもう一度お試しください' })
  }
  try {
    var body = JSON.parse(e.postData.contents)
    if (body.secret !== GAS_SECRET) return respond({ error: 'Unauthorized' })

    var payments = body.payments || []
    var syncedIds = payments
      .filter(function(p) { return !p.canceledAt && !p.canceled_at })
      .map(function(p) { return p.id })

    // 送信元の店舗だけを再構築する（未指定なら全店舗）
    var only = null
    if (body.storeIds && body.storeIds.length > 0) {
      only = body.storeIds.map(String)
    } else if (body.storeId !== undefined && body.storeId !== null) {
      only = [String(body.storeId)]
    }

    // 先にシートを再構築し、成功してから同期済みにする
    // （途中失敗時に payments が「同期済み」で固定化して欠落するのを防ぐ）
    var now = new Date()
    var year = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy')
    rebuildAllSheets(year, only)

    if (now.getMonth() === 0 && now.getDate() <= 7) {
      rebuildAllSheets(String(parseInt(year, 10) - 1), only)
    }

    if (syncedIds.length > 0) markSynced(syncedIds)

    return respond({ syncedIds: syncedIds })
  } catch (err) {
    return respond({ error: err.toString() })
  } finally {
    lock.releaseLock()
  }
}

// ── 対象店舗の一覧（Supabase の stores が正） ────────────────────────
// 店舗を増やしたら stores に足すだけでシートが1枚増える
function getStores() {
  var stores = fetchStores()
  if (stores.length === 0) {
    Logger.log('[stores] 取得できなかったため既定リストを使用')
    stores = FALLBACK_STORES
  }

  var only = PROPS.getProperty('STORE_IDS')
  if (only) {
    var allow = only.split(',').map(function(s) { return s.trim() })
    stores = stores.filter(function(s) { return allow.indexOf(s.id) !== -1 })
  }

  var coords = {}
  Object.keys(DEFAULT_STORE_COORDS).forEach(function(k) { coords[k] = DEFAULT_STORE_COORDS[k] })
  var override = PROPS.getProperty('STORE_COORDS_JSON')
  if (override) {
    try {
      var parsed = JSON.parse(override)
      Object.keys(parsed).forEach(function(k) { coords[k] = parsed[k] })
    } catch (err) {
      Logger.log('[stores] STORE_COORDS_JSON が不正です: %s', err)
    }
  }

  return stores.map(function(s) {
    var c = coords[s.id] || FALLBACK_COORDS
    return { id: s.id, name: s.name, lat: String(c.lat), lng: String(c.lng) }
  })
}

// ── 全店舗ぶんのシートを再構築（1スプレッドシート＝1年） ─────────────
function rebuildAllSheets(year, onlyStoreIds) {
  var stores = getStores()
  if (onlyStoreIds) {
    stores = stores.filter(function(s) { return onlyStoreIds.indexOf(s.id) !== -1 })
  }
  if (stores.length === 0) {
    Logger.log('[rebuild] 対象店舗なし')
    return
  }

  var ss = getOrCreateSpreadsheet(year)
  Logger.log('[rebuild] year=%s 書き込み先 spreadsheet="%s" url=%s', year, ss.getName(), ss.getUrl())

  // 祝日はカレンダーAPIを日ごとに叩くと店舗数ぶん遅くなるため、年に1回まとめて引く
  var holidays = fetchHolidayMap(year)

  stores.forEach(function(store) {
    try {
      rebuildStoreSheet(ss, year, store, holidays)
    } catch (err) {
      // 1店舗が失敗しても他店舗は書き切る
      Logger.log('[rebuild] %s で失敗: %s', store.name, err)
    }
  })
}

// ── 1店舗ぶんのシートを全再構築 ──────────────────────────────────────
function rebuildStoreSheet(ss, year, store, holidays) {
  // データが0件でもシート自体は作る（開店前の店舗のタブを用意しておく）
  var sheet = getOrCreateSheet(ss, store)

  var allPayments = fetchPaymentsForYear(year, store.id)
  var expenseList = fetchExpensesForYear(year, store.id)
  Logger.log('[rebuild] %s year=%s payments=%s expenses=%s', store.name, year, allPayments.length, expenseList.length)

  var expenseMap = {}
  expenseList.forEach(function(e) { expenseMap[e.business_date] = e })

  var activePayments = allPayments.filter(function(p) { return !p.canceled_at })
  var byDay = groupBy(activePayments, function(p) { return p.business_date })

  var allDates = Object.keys(byDay)
  Object.keys(expenseMap).forEach(function(d) {
    if (allDates.indexOf(d) === -1) allDates.push(d)
  })
  if (allDates.length === 0) {
    Logger.log('[rebuild] %s 対象日なし → 書き込みスキップ', store.name)
    return
  }
  allDates.sort()

  // 天気をAPIで取得し、直近5日分はシートの既存入力をフォールバックとして使う
  var weatherFromApi = fetchWeatherForYear(year, store.lat, store.lng)
  var weatherFromSheet = readExistingWeather(sheet)

  // データ行をクリアして再構築。
  // deleteRows だと「固定行以外を全て削除」になる場合にエラーになるため内容だけ消す
  var lastRow = sheet.getLastRow()
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent()
  }

  var allRows = []

  allDates.forEach(function(date) {
    var dayPayments = byDay[date] || []
    var expense = expenseMap[date] || null

    var totalSales    = dayPayments.reduce(function(s, p) { return s + (p.total_amount    || 0) }, 0)
    var totalCash     = dayPayments.reduce(function(s, p) { return s + (p.cash_amount     || 0) }, 0)
    var totalCashless = dayPayments.reduce(function(s, p) { return s + (p.cashless_amount || 0) }, 0)
    var totalDiscount = dayPayments.reduce(function(s, p) { return s + (p.discount_amount || 0) }, 0)
    // 来客数・組数は伝票単位で数える
    var all = countBySession(dayPayments)
    var newOnes = countBySession(dayPayments.filter(function(p) { return p.is_new_customer }))
    var expenseAmt    = expense ? (expense.amount        || 0) : 0
    var expenseCount  = expense ? (expense.receipt_count || 0) : 0
    var profit = totalSales - expenseAmt
    var dateStr = toDateStr(date)
    // APIデータ優先、なければシートの既存値（直近で未取得の日）
    var weather = weatherFromApi[dateStr] || weatherFromSheet[dateStr] || ''
    // business_date は 'yyyy-MM-dd'。数値で入れて集計・フィルタしやすくする
    var ymd = date.split('-')

    allRows.push([
      Number(ymd[0]), Number(ymd[1]), Number(ymd[2]),
      getDayStr(date, holidays),
      weather,
      all.guests,
      all.groups,
      newOnes.guests,
      newOnes.groups,
      totalSales, totalCash, totalCashless,
      totalDiscount,
      expenseAmt, expenseCount, profit
    ])
  })

  if (allRows.length === 0) return
  // 書き込む行数がシートの行数を超えていたら足す（行削除をやめたぶん自前で確保する）
  var neededRows = allRows.length + 1
  var maxRows = sheet.getMaxRows()
  if (maxRows < neededRows) sheet.insertRowsAfter(maxRows, neededRows - maxRows)
  sheet.getRange(2, 1, allRows.length, HEADERS.length).setValues(allRows)
  // clearContent() は書式を消さない。旧「日付」列に残った日付書式のまま
  // 年(2026)を書くと 1905/7/18 と表示されるため、書式を明示的に戻す
  sheet.getRange(2, DATE_COL, allRows.length, DATE_COL_COUNT).setNumberFormat('0')
  Logger.log('[rebuild] %s に %s 行を書き込み完了', store.name, allRows.length)
}

// ── 来客数・組数の集計 ───────────────────────────────────────────────
// 個別会計で会計が複数回に分かれても、1組・1回ぶんの人数として数える
function countBySession(payments) {
  var guestsBySession = {}
  payments.forEach(function(p) {
    var sid = p.session_id
    var guests = p.guest_count || 0
    if (guestsBySession[sid] === undefined || guestsBySession[sid] < guests) {
      guestsBySession[sid] = guests
    }
  })
  var sids = Object.keys(guestsBySession)
  return {
    groups: sids.length,
    guests: sids.reduce(function(s, sid) { return s + guestsBySession[sid] }, 0),
  }
}

// ── 既存シートから天気データを読み取る（日付→天気のマップ） ──────────
function readExistingWeather(sheet) {
  var lastRow = sheet.getLastRow()
  if (lastRow <= 1) return {}
  var width = Math.min(sheet.getMaxColumns(), WEATHER_COL)
  var data = sheet.getRange(2, 1, lastRow - 1, width).getValues()
  var map = {}
  data.forEach(function(row) {
    var key = null
    var weather = null
    var md = readMonthDay(row)
    if (md) {
      // 現行レイアウト: 年 / 月 / 日 / 曜日 / 天気
      key = md.month + '/' + md.day
      weather = row[WEATHER_COL - 1]
    } else if (row[0]) {
      // 旧レイアウト（日付1列）: M/D / 曜日 / 天気
      // 列を分割した直後の1回だけここを通る。手入力した天気を捨てないための経過措置
      var d = row[0]
      // Sheets が日付セルを Date 型で返す場合があるため M/D 文字列に正規化
      if (d instanceof Date) d = (d.getMonth() + 1) + '/' + d.getDate()
      key = String(d)
      weather = row[LEGACY_WEATHER_COL - 1]
    }
    // 天気は必ず文字列。レイアウトを読み違えて数値を拾ったときは捨てる
    if (key && typeof weather === 'string' && weather) map[key] = weather
  })
  return map
}

// 現行レイアウト（年/月/日）なら { month, day } を返す。旧レイアウトなら null。
// 2列目・3列目が月日として妥当な数値かで判定する（旧レイアウトの2列目は曜日の文字列）。
// 1列目は、日付書式が残っているシートでは年の数値ではなく Date として返るため
// 「Date か、2000〜2200 の数値」の両方を許容する
function readMonthDay(row) {
  var month = Number(row[1])
  var day = Number(row[2])
  if (!(month >= 1 && month <= 12)) return null
  if (!(day >= 1 && day <= 31)) return null
  if (row[0] instanceof Date) return { month: month, day: day }
  var year = Number(row[0])
  if (year >= 2000 && year <= 2200) return { month: month, day: day }
  return null
}

// ── スプレッドシート取得 or 作成（年次単位・全店舗で共有） ───────────
function getOrCreateSpreadsheet(year) {
  var title = year + '年 会計'
  var folder = DriveApp.getFolderById(DRIVE_FOLDER_ID)
  var files = folder.getFilesByName(title)
  if (files.hasNext()) return SpreadsheetApp.open(files.next())
  var ss = SpreadsheetApp.create(title)
  DriveApp.getFileById(ss.getId()).moveTo(folder)
  return ss
}

// ── 店舗シート取得 or 作成（ヘッダー行を常に最新化） ─────────────────
function getOrCreateSheet(ss, store) {
  var title = store.name
  var sheet = ss.getSheetByName(title)

  // 1店舗運用だった頃の「会計」シートは目黒店シートとして引き継ぐ
  // （手入力した天気を捨てずに済む）
  if (!sheet && store.id === LEGACY_STORE_ID) {
    var legacy = ss.getSheetByName(LEGACY_SHEET_NAME)
    if (legacy) {
      legacy.setName(title)
      sheet = legacy
      Logger.log('[sheet] "%s" を "%s" にリネームしました', LEGACY_SHEET_NAME, title)
    }
  }

  if (!sheet) {
    sheet = ss.insertSheet(title)
    sheet.setFrozenRows(1)
  }
  // 列を増やしたときに既存シートが狭いままだと書き込めないので広げる
  var maxCols = sheet.getMaxColumns()
  if (maxCols < HEADERS.length) {
    sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols)
  }
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length)
  headerRange.setValues([HEADERS])
  headerRange.setFontWeight('bold')
  headerRange.setBackground('#4a86e8')
  headerRange.setFontColor('#ffffff')
  return sheet
}

// ── 診断用: 対象店舗と書き込み先をログ出力（手動実行） ───────────────
function debugStores() {
  var stores = getStores()
  Logger.log('[debug] 対象店舗数=%s', stores.length)
  stores.forEach(function(s) {
    Logger.log('[debug] id=%s name="%s" lat=%s lng=%s', s.id, s.name, s.lat, s.lng)
  })
  var year = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy')
  var ss = getOrCreateSpreadsheet(year)
  Logger.log('[debug] spreadsheet="%s" url=%s', ss.getName(), ss.getUrl())
  Logger.log('[debug] 既存シート: %s', ss.getSheets().map(function(sh) { return sh.getName() }).join(', '))
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
    Logger.log('[debug] #%s id=%s store_id=%s business_date="%s" canceled_at=%s total=%s',
      i, p.id, p.store_id, p.business_date, p.canceled_at, p.total_amount)
  })
}

// ── Supabase 共通 ────────────────────────────────────────────────────
function supabaseGet(path) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
    muteHttpExceptions: true,
  })
  var data = JSON.parse(res.getContentText())
  if (!Array.isArray(data)) {
    Logger.log('[supabase取得エラー] path=%s status=%s body=%s', path, res.getResponseCode(), res.getContentText().slice(0, 300))
    return []
  }
  return data
}

// ── Supabase: 店舗一覧 ───────────────────────────────────────────────
function fetchStores() {
  return supabaseGet('stores?select=id,name&order=id.asc').map(function(s) {
    return { id: String(s.id), name: s.name }
  })
}

// ── Supabase: 未同期 payments 取得（全店舗ぶん） ─────────────────────
function fetchUnsyncedPayments() {
  return supabaseGet('payments?synced_to_sheet_at=is.null&canceled_at=is.null&order=payment_datetime.asc')
}

// ── Supabase: 指定年・指定店舗の全 payments 取得 ─────────────────────
function fetchPaymentsForYear(year, storeId) {
  return supabaseGet('payments'
    + '?store_id=eq.' + storeId
    + '&business_date=gte.' + year + '-01-01'
    + '&business_date=lte.' + year + '-12-31'
    + '&canceled_at=is.null'
    + '&order=business_date.asc,payment_datetime.asc')
}

// ── Supabase: 指定年・指定店舗の daily_expenses 取得 ─────────────────
function fetchExpensesForYear(year, storeId) {
  return supabaseGet('daily_expenses'
    + '?store_id=eq.' + storeId
    + '&business_date=gte.' + year + '-01-01'
    + '&business_date=lte.' + year + '-12-31')
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

// ── Open-Meteo: 指定年・指定座標の天気を取得（日付→天気文字列のマップ） ──
// アーカイブAPIは約5日前までしか持たないため、
// 直近分（過去7日+今日）は予報APIの past_days で補完する
function fetchWeatherForYear(year, lat, lng) {
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
    data.daily.time.forEach(function(dateStr, i) {
      if (dateStr.slice(0, 4) !== year) return
      var d = new Date(dateStr + 'T00:00:00')
      var key = (d.getMonth() + 1) + '/' + d.getDate()
      var text = wmoToJa(data.daily.weathercode[i])
      if (text) result[key] = text
    })
  } catch (err) {
    Logger.log('[weather] 取得失敗: %s', err)
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

// ── 祝日: 1年ぶんをまとめて取得（yyyy-MM-dd → true） ─────────────────
// 日ごとに getEventsForDay を呼ぶと「店舗数 × 日数」ぶん通信が発生して
// 実行時間の上限（6分）に当たるため、年に1回だけ引いて使い回す
function fetchHolidayMap(year) {
  var map = {}
  try {
    var cal = CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com')
    if (!cal) return map
    var start = new Date(year + '-01-01T00:00:00+09:00')
    var end = new Date((parseInt(year, 10) + 1) + '-01-01T00:00:00+09:00')
    cal.getEvents(start, end).forEach(function(ev) {
      map[Utilities.formatDate(ev.getStartTime(), 'Asia/Tokyo', 'yyyy-MM-dd')] = true
    })
    Logger.log('[holiday] %s年の祝日 %s 件', year, Object.keys(map).length)
  } catch (err) {
    Logger.log('[holiday] 取得失敗: %s', err)
  }
  return map
}

// ── ユーティリティ ───────────────────────────────────────────────────

function groupBy(arr, keyFn) {
  return arr.reduce(function(acc, item) {
    var key = keyFn(item)
    ;(acc[key] = acc[key] || []).push(item)
    return acc
  }, {})
}

// 天気マップのキー: M/D 形式（シートの表示列ではなく内部キー）
function toDateStr(businessDate) {
  var d = new Date(businessDate + 'T00:00:00')
  return (d.getMonth() + 1) + '/' + d.getDate()
}

// 曜日列: 曜日＋祝日判定（祝日マップは fetchHolidayMap 参照）
function getDayStr(businessDate, holidays) {
  var d = new Date(businessDate + 'T00:00:00')
  var day = DAYS_JA[d.getDay()]
  if (holidays && holidays[businessDate]) return day + '（祝）'
  return day
}

function formatJstTime(isoString) {
  return Utilities.formatDate(new Date(isoString), 'Asia/Tokyo', 'HH:mm')
}

function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}
