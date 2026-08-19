import type { BlockSession, ServiceBlock } from "@/lib/pos-types"

// 席の「現在の来店」を判断するための純粋関数群。
//
// sessions には同じ席の過去セッションが全件入っている（fetchSessions は日付で絞っていない）。
// そのため「その席に紐づくセッション」を素朴に拾うと前の組の情報を掴んでしまい、
// 無関係な席が連結表示されたり、別の組を巻き込んで空席化したりする。
// 判定をここに集約してテストできるようにしている。

/** 判定に必要な最小限のセッション情報 */
export type SessionLike = Pick<BlockSession, "id" | "blockId" | "linkedBlockIds" | "endedAt">
/** 接客情報（次の客に持ち越してはいけないもの） */
export type GuestInfoLike = Pick<
  BlockSession,
  "customerName" | "note" | "happyHour" | "isNewCustomer"
>
/** 判定に必要な最小限の席情報 */
export type BlockLike = Pick<ServiceBlock, "id" | "status">

/** 次の客に持ち越してはいけない接客情報を持っているか */
export function hasGuestInfo(s: GuestInfoLike): boolean {
  return !!s.customerName || !!s.note || !!s.happyHour || !!s.isNewCustomer
}

/**
 * 下膳（空席化）時に持ち越してはいけない接客情報を落とす。
 * 会計時の顧客名は payments 側へ別途コピー済みのため、売上履歴には影響しない。
 */
export function stripGuestInfo<S extends GuestInfoLike>(s: S): S {
  return {
    ...s,
    customerName: undefined,
    note: undefined,
    // happy_hour / is_new_customer は NOT NULL 相当で常に boolean が返るため、
    // undefined ではなく false に揃える
    happyHour: false,
    isNewCustomer: false,
  }
}

/** 席ごとに最新の終了済みセッションだけを残す */
function latestEndedByBlock<S extends SessionLike>(sessions: readonly S[]): Map<string, S> {
  const map = new Map<string, S>()
  for (const s of sessions) {
    if (!s.endedAt) continue
    const cur = map.get(s.blockId)
    if (!cur || s.endedAt.getTime() > cur.endedAt!.getTime()) map.set(s.blockId, s)
  }
  return map
}

/**
 * フロアマップで「連結中」と表示する席を求める。
 *
 * バッシング完了（empty）まで連結表示を維持するため会計済み(endedAt あり)も参照するが、
 * 終了済みセッションが持つのは「前の組」の連結情報。プライマリ席の現在ステータスだけで
 * 採否を決めると、その席が checked_out になった瞬間に何日も前の連結相手が復活する。
 * そのため
 *   1) その席の最新セッションであること
 *   2) 連結先も未バッシング(checked_out)で、自前のアクティブセッションを持たないこと
 * を満たすものだけを採用する。
 */
export function resolveSeatLinks<S extends SessionLike>(
  sessions: readonly S[],
  blocks: readonly BlockLike[],
): { linkedSecondaryIds: Set<string>; primaryWithLinkIds: Set<string> } {
  const linkedSecondaryIds = new Set<string>()
  const primaryWithLinkIds = new Set<string>()
  const statusOf = (id: string) => blocks.find((b) => b.id === id)?.status
  const activeBlockIds = new Set(sessions.filter((s) => !s.endedAt).map((s) => s.blockId))

  const candidates = [...sessions.filter((s) => !s.endedAt), ...latestEndedByBlock(sessions).values()]
  for (const s of candidates) {
    if (!s.linkedBlockIds?.length) continue
    let secondaries = s.linkedBlockIds
    if (s.endedAt) {
      if (statusOf(s.blockId) !== "checked_out") continue
      secondaries = secondaries.filter(
        (id) => statusOf(id) === "checked_out" && !activeBlockIds.has(id),
      )
    }
    if (secondaries.length === 0) continue
    primaryWithLinkIds.add(s.blockId)
    secondaries.forEach((id) => linkedSecondaryIds.add(id))
  }
  return { linkedSecondaryIds, primaryWithLinkIds }
}

/**
 * 空席化（バッシング）で対象にする席と、掃除するセッションを求める。
 *
 * blockIds        … empty にする席。連結グループはまとめて対象になる
 * sessionsToClean … 終了させ、接客情報を落とすセッション
 */
export function resolveBussingTargets<S extends SessionLike & GuestInfoLike>(
  sessions: readonly S[],
  blocks: readonly BlockLike[],
  blockId: string,
): { blockIds: string[]; sessionsToClean: S[] } {
  const related = sessions.filter(
    (s) => s.blockId === blockId || (s.linkedBlockIds ?? []).includes(blockId),
  )
  // endedAt なしのゴーストセッション（DB 未同期の古いセッション対策）。
  // 複数残っていることがあるため1件だけでなく全件を対象にする。
  const ghostSessions = related.filter((s) => !s.endedAt)
  const latestEnded = related
    .filter((s) => s.endedAt)
    .sort((a, b) => b.endedAt!.getTime() - a.endedAt!.getTime())[0]

  // 現在の連結構成はアクティブなセッションが持つため、あればそちらを優先する。
  const linkedFromGhosts = ghostSessions.flatMap((s) => [s.blockId, ...(s.linkedBlockIds ?? [])])
  // アクティブ側に連結情報が無いときは、直前に会計されたグループの構成で補う。
  // ただし終了済みセッションは前の組の連結情報であることがあり、別の組を巻き込んで
  // 空席化しかねないため、まだ会計済み(checked_out)のままの席だけを対象にする。
  const blockStatusById = new Map(blocks.map((b) => [b.id, b.status]))
  const linkedFromEnded =
    latestEnded && !ghostSessions.some((s) => s.linkedBlockIds?.length)
      ? [latestEnded.blockId, ...(latestEnded.linkedBlockIds ?? [])].filter(
          (id) => id === blockId || blockStatusById.get(id) === "checked_out",
        )
      : []

  return {
    blockIds: Array.from(new Set([blockId, ...linkedFromGhosts, ...linkedFromEnded])),
    // ゴーストは終了させ、終了済みセッションからも接客情報を落とす。
    // endedAt の同期に失敗した場合でも、次の客に顧客名・備考・HH が復活しないようにする。
    // 過去セッションは履歴なので書き換えない。
    sessionsToClean: [
      ...ghostSessions,
      ...(latestEnded && hasGuestInfo(latestEnded) ? [latestEnded] : []),
    ],
  }
}

/**
 * 空席なのに終了していないセッション（孤児）を求める。
 * 席を開くまで残り続け、次の客に顧客名・HH・入店時間が引き継がれてしまうため
 * 読み込み時にまとめて終了させる。
 * 未会計のオーダーが残っているものは席のステータス側が壊れている可能性があるので触らない。
 */
export function findOrphanSessions<
  S extends SessionLike & { orderItems: readonly { isPaid: boolean }[] },
>(sessions: readonly S[], blocks: readonly BlockLike[]): S[] {
  const statusById = new Map(blocks.map((b) => [b.id, b.status]))
  return sessions.filter(
    (s) =>
      !s.endedAt &&
      statusById.get(s.blockId) === "empty" &&
      !s.orderItems.some((i) => !i.isPaid),
  )
}

/**
 * 非空席から空席へ変化した席を求める。
 * 顧客名・HH のキャッシュは端末ごとに持つため他端末の空席化では消えない。
 * その取りこぼしを埋めるために使う。
 * 「空席のまま顧客名だけ先に入力しておく」運用を壊さないよう、
 * 元から空席だった席は対象にしない。
 */
export function findJustEmptiedBlockIds(
  prevStatusById: Readonly<Record<string, ServiceBlock["status"]>>,
  blocks: readonly BlockLike[],
): string[] {
  return blocks
    .filter((b) => b.status === "empty" && prevStatusById[b.id] && prevStatusById[b.id] !== "empty")
    .map((b) => b.id)
}
