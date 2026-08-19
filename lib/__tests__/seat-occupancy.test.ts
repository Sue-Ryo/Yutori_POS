import { describe, it, expect } from "vitest"
import {
  hasGuestInfo,
  stripGuestInfo,
  resolveSeatLinks,
  resolveBussingTargets,
  findOrphanSessions,
  findJustEmptiedBlockIds,
  type BlockLike,
} from "../seat-occupancy"

// 同じ席の過去セッションが sessions に全件入っている前提の回帰テスト。
// 実際に発生した不具合の再現ケースを含む:
//  - 会計済み(水色)になった瞬間に、何日も前の連結相手が「連結中」表示になる
//  - 空席化してもゴーストが残り、次の客に顧客名・HH が引き継がれる
//  - 連結相手の席が空席化されず取り残される

type S = {
  id: string
  blockId: string
  linkedBlockIds?: string[]
  endedAt?: Date
  customerName?: string
  note?: string
  happyHour?: boolean
  isNewCustomer?: boolean
  orderItems: { isPaid: boolean }[]
}

const t = (min: number) => new Date(2026, 7, 17, 10, min)
const s = (o: Partial<S> & { id: string; blockId: string }): S => ({ orderItems: [], ...o })
const blk = (id: string, status: BlockLike["status"]): BlockLike => ({ id, status })
const sorted = (v: Iterable<string>) => [...v].sort()

describe("hasGuestInfo / stripGuestInfo", () => {
  it("接客情報の有無を判定する", () => {
    expect(hasGuestInfo({})).toBe(false)
    expect(hasGuestInfo({ customerName: "たなか" })).toBe(true)
    expect(hasGuestInfo({ happyHour: true })).toBe(true)
    expect(hasGuestInfo({ note: "備考" })).toBe(true)
    expect(hasGuestInfo({ isNewCustomer: true })).toBe(true)
  })

  it("空文字の顧客名は接客情報として扱わない", () => {
    expect(hasGuestInfo({ customerName: "" })).toBe(false)
  })

  it("接客情報を落とし、他のフィールドは保つ", () => {
    const before = s({ id: "x", blockId: "A", customerName: "たなか", happyHour: true, note: "備考" })
    const after = stripGuestInfo(before)
    expect(after.customerName).toBeUndefined()
    expect(after.note).toBeUndefined()
    // NOT NULL 相当のため undefined ではなく false に揃える
    expect(after.happyHour).toBe(false)
    expect(after.isNewCustomer).toBe(false)
    expect(after.blockId).toBe("A")
  })
})

describe("resolveSeatLinks（連結表示の判定）", () => {
  it("使用中の連結は表示される", () => {
    const r = resolveSeatLinks(
      [s({ id: "1", blockId: "A", linkedBlockIds: ["B"] })],
      [blk("A", "occupied"), blk("B", "occupied")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual(["B"])
    expect(sorted(r.primaryWithLinkIds)).toEqual(["A"])
  })

  it("会計済みだが未バッシングの間は連結表示を維持する", () => {
    const r = resolveSeatLinks(
      [s({ id: "1", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) })],
      [blk("A", "checked_out"), blk("B", "checked_out")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual(["B"])
  })

  it("バッシング後(empty)は連結表示が消える", () => {
    const r = resolveSeatLinks(
      [s({ id: "1", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) })],
      [blk("A", "empty"), blk("B", "empty")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual([])
  })

  it("過去の連結 + 新しい単独セッションなら誤表示しない", () => {
    const r = resolveSeatLinks(
      [
        s({ id: "old", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) }),
        s({ id: "new", blockId: "A", endedAt: t(30) }),
      ],
      [blk("A", "checked_out"), blk("B", "empty")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual([])
  })

  it("連結相手が別の客で使用中なら誤表示しない", () => {
    const r = resolveSeatLinks(
      [
        s({ id: "old", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) }),
        s({ id: "new", blockId: "A", endedAt: t(30) }),
        s({ id: "other", blockId: "B" }),
      ],
      [blk("A", "checked_out"), blk("B", "occupied")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual([])
  })

  it("過去も今回も同じ相手と連結していれば今回分で表示する", () => {
    const r = resolveSeatLinks(
      [
        s({ id: "old", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) }),
        s({ id: "new", blockId: "A", linkedBlockIds: ["B"], endedAt: t(30) }),
      ],
      [blk("A", "checked_out"), blk("B", "checked_out")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual(["B"])
  })

  it("3席連結の会計済み未バッシングは2席とも表示する", () => {
    const r = resolveSeatLinks(
      [s({ id: "1", blockId: "A", linkedBlockIds: ["B", "C"], endedAt: t(0) })],
      [blk("A", "checked_out"), blk("B", "checked_out"), blk("C", "checked_out")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual(["B", "C"])
  })

  it("3席連結で1席だけ先に空席化されたら残りだけ表示する", () => {
    const r = resolveSeatLinks(
      [s({ id: "1", blockId: "A", linkedBlockIds: ["B", "C"], endedAt: t(0) })],
      [blk("A", "checked_out"), blk("B", "checked_out"), blk("C", "empty")],
    )
    expect(sorted(r.linkedSecondaryIds)).toEqual(["B"])
  })
})

describe("resolveBussingTargets（空席化の対象）", () => {
  it("単独席はその席だけを空席化する", () => {
    const sessions = [s({ id: "x", blockId: "A", endedAt: t(10), customerName: "たなか" })]
    const r = resolveBussingTargets(sessions, [blk("A", "checked_out")], "A")
    expect(sorted(r.blockIds)).toEqual(["A"])
    expect(r.sessionsToClean.map((v) => v.id)).toEqual(["x"])
  })

  it("連結グループはまとめて空席化する", () => {
    const sessions = [s({ id: "x", blockId: "A", linkedBlockIds: ["B"], endedAt: t(10) })]
    const blocks = [blk("A", "checked_out"), blk("B", "checked_out")]
    expect(sorted(resolveBussingTargets(sessions, blocks, "A").blockIds)).toEqual(["A", "B"])
  })

  it("連結サブ席をタップしてもグループ全体を空席化する", () => {
    const sessions = [s({ id: "x", blockId: "A", linkedBlockIds: ["B"], endedAt: t(10) })]
    const blocks = [blk("A", "checked_out"), blk("B", "checked_out")]
    expect(sorted(resolveBussingTargets(sessions, blocks, "B").blockIds)).toEqual(["A", "B"])
  })

  it("ゴーストに連結情報が無くても連結相手を取り残さない", () => {
    const sessions = [
      s({ id: "ghost", blockId: "A" }),
      s({ id: "cur", blockId: "A", linkedBlockIds: ["B"], endedAt: t(10), customerName: "たなか" }),
    ]
    const blocks = [blk("A", "checked_out"), blk("B", "checked_out")]
    expect(sorted(resolveBussingTargets(sessions, blocks, "A").blockIds)).toEqual(["A", "B"])
  })

  it("終了済みの連結相手が別の客で使用中なら巻き込まない", () => {
    const sessions = [
      s({ id: "ghost", blockId: "A" }),
      s({ id: "cur", blockId: "A", linkedBlockIds: ["B"], endedAt: t(10) }),
    ]
    const blocks = [blk("A", "checked_out"), blk("B", "occupied")]
    expect(sorted(resolveBussingTargets(sessions, blocks, "A").blockIds)).toEqual(["A"])
  })

  it("既に空席の連結相手は対象にしない", () => {
    const sessions = [s({ id: "cur", blockId: "A", linkedBlockIds: ["B"], endedAt: t(10) })]
    const blocks = [blk("A", "checked_out"), blk("B", "empty")]
    expect(sorted(resolveBussingTargets(sessions, blocks, "A").blockIds)).toEqual(["A"])
  })

  it("ゴーストが複数あっても全件終了させる", () => {
    const sessions = [
      s({ id: "g1", blockId: "A" }),
      s({ id: "g2", blockId: "A", customerName: "のこり" }),
    ]
    const r = resolveBussingTargets(sessions, [blk("A", "checked_out")], "A")
    expect(sorted(r.sessionsToClean.map((v) => v.id))).toEqual(["g1", "g2"])
  })

  it("過去の連結相手を巻き込まない", () => {
    const sessions = [
      s({ id: "old", blockId: "A", linkedBlockIds: ["B"], endedAt: t(0) }),
      s({ id: "cur", blockId: "A", endedAt: t(30), customerName: "いま" }),
    ]
    const blocks = [blk("A", "checked_out"), blk("B", "checked_out")]
    const r = resolveBussingTargets(sessions, blocks, "A")
    expect(sorted(r.blockIds)).toEqual(["A"])
    expect(r.sessionsToClean.map((v) => v.id)).toEqual(["cur"])
  })

  it("過去セッションの接客情報は書き換えない", () => {
    const sessions = [
      s({ id: "h1", blockId: "A", endedAt: t(0), customerName: "むかし" }),
      s({ id: "h2", blockId: "A", endedAt: t(5), customerName: "むかし2" }),
      s({ id: "cur", blockId: "A", endedAt: t(30), customerName: "いま" }),
    ]
    const r = resolveBussingTargets(sessions, [blk("A", "checked_out")], "A")
    expect(r.sessionsToClean.map((v) => v.id)).toEqual(["cur"])
  })

  it("接客情報が無い終了済みセッションは掃除対象にしない", () => {
    const sessions = [s({ id: "cur", blockId: "A", endedAt: t(30) })]
    expect(resolveBussingTargets(sessions, [blk("A", "checked_out")], "A").sessionsToClean).toEqual([])
  })

  it("関係するセッションが無くてもタップした席は空席化する", () => {
    expect(sorted(resolveBussingTargets([], [blk("A", "checked_out")], "A").blockIds)).toEqual(["A"])
  })
})

describe("findOrphanSessions（空席に残ったセッション）", () => {
  const blocks = [blk("h8", "empty"), blk("A", "occupied"), blk("B", "empty")]

  it("空席かつ未会計オーダーが無いものだけを掃除する", () => {
    const sessions = [
      s({ id: "orphan", blockId: "h8" }),
      s({ id: "live", blockId: "A", orderItems: [{ isPaid: false }] }),
      s({ id: "broken", blockId: "B", orderItems: [{ isPaid: false }] }),
      s({ id: "paid", blockId: "B", orderItems: [{ isPaid: true }] }),
      s({ id: "done", blockId: "B", endedAt: t(10) }),
    ]
    expect(sorted(findOrphanSessions(sessions, blocks).map((v) => v.id))).toEqual(["orphan", "paid"])
  })

  it("未会計オーダーが残っている席は触らない", () => {
    const sessions = [s({ id: "broken", blockId: "B", orderItems: [{ isPaid: false }] })]
    expect(findOrphanSessions(sessions, blocks)).toEqual([])
  })
})

describe("findJustEmptiedBlockIds（他端末の空席化検知）", () => {
  it("使用中から空席へ変化した席を返す", () => {
    expect(findJustEmptiedBlockIds({ A: "occupied" }, [blk("A", "empty")])).toEqual(["A"])
  })

  it("会計済みから空席へ変化した席を返す", () => {
    expect(findJustEmptiedBlockIds({ A: "checked_out" }, [blk("A", "empty")])).toEqual(["A"])
  })

  it("元から空席の席は返さない（入力中の顧客名を消さない）", () => {
    const prev = { A: "empty" as const, B: "occupied" as const }
    expect(findJustEmptiedBlockIds(prev, [blk("A", "empty"), blk("B", "empty")])).toEqual(["B"])
  })

  it("初回（前回状態が無い）は何も返さない", () => {
    expect(findJustEmptiedBlockIds({}, [blk("A", "empty")])).toEqual([])
  })

  it("変化が無ければ何も返さない", () => {
    expect(findJustEmptiedBlockIds({ A: "occupied" }, [blk("A", "occupied")])).toEqual([])
  })

  it("連結グループがまとめて空席化された場合は全席返す", () => {
    const prev = { A: "checked_out" as const, B: "checked_out" as const }
    expect(sorted(findJustEmptiedBlockIds(prev, [blk("A", "empty"), blk("B", "empty")]))).toEqual([
      "A",
      "B",
    ])
  })
})
