"use client"

import * as React from "react"

/**
 * IME（日本語変換）中の Enter / キー操作かどうか。
 * 変換確定の Enter を「送信」と誤認しないためのガード。
 * keyCode 229 は isComposing 未対応ブラウザ用のフォールバック。
 */
export function isComposingEvent(e: React.KeyboardEvent): boolean {
  return (e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229
}

type ImeInputProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "defaultValue"
> & {
  value: string
  onValueChange: (value: string) => void
  /** 入力停止からこの時間(ms)後に確定通知。変換中は通知しない */
  commitDelay?: number
}

/**
 * IME 安全なテキスト入力。
 * - 変換未確定中は親へ通知しない（未確定文字が消える／カーソルが飛ぶのを防ぐ）
 * - 入力中は外部値（DB・他端末同期）で上書きされない
 * - 自分の書き込みがエコーで返るまでの間、古い値への巻き戻しを無視する
 * - blur / アンマウント時に未送出分を確実に反映する
 */
export const ImeInput = React.forwardRef<HTMLInputElement, ImeInputProps>(
  function ImeInput(
    {
      value,
      onValueChange,
      commitDelay = 400,
      onCompositionStart,
      onCompositionEnd,
      onFocus,
      onBlur,
      onInput,
      ...props
    },
    ref,
  ) {
    const [draft, setDraft] = React.useState(value)

    const draftRef = React.useRef(value)
    const composingRef = React.useRef(false)
    const focusedRef = React.useRef(false)
    const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    // 最後に親へ送出した値（＝DB へ書きに行った値）
    const committedRef = React.useRef(value)
    // 自分の書き込みのエコー待ち期限。この間は異なる外部値を無視する
    const pendingUntilRef = React.useRef(0)

    const onValueChangeRef = React.useRef(onValueChange)
    React.useEffect(() => {
      onValueChangeRef.current = onValueChange
    })

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const commit = React.useCallback((next: string) => {
      clearTimer()
      if (next === committedRef.current) return
      committedRef.current = next
      pendingUntilRef.current = Date.now() + 3000
      onValueChangeRef.current(next)
    }, [])

    const scheduleCommit = (next: string) => {
      clearTimer()
      if (commitDelay <= 0) return
      timerRef.current = setTimeout(() => commit(next), commitDelay)
    }

    // 外部値の取り込み。編集中は一切上書きしない
    React.useEffect(() => {
      if (focusedRef.current || composingRef.current) return
      if (value === committedRef.current) {
        // 自分の書き込みが返ってきた（もしくは一致） → エコー待ち解除
        pendingUntilRef.current = 0
      } else if (Date.now() < pendingUntilRef.current) {
        // まだ古い値が返ってきている段階。巻き戻さない
        return
      }
      if (value === draftRef.current) return
      draftRef.current = value
      committedRef.current = value
      setDraft(value)
    }, [value])

    // アンマウント（サイドバーを閉じた等）時に未送出分を反映
    React.useEffect(
      () => () => {
        clearTimer()
        if (draftRef.current !== committedRef.current) {
          committedRef.current = draftRef.current
          onValueChangeRef.current(draftRef.current)
        }
      },
      [],
    )

    const setLocal = (next: string) => {
      draftRef.current = next
      setDraft(next)
    }

    return (
      <input
        ref={ref}
        type="text"
        // iOS/iPadOS の自動補正・自動大文字化が日本語入力を壊すのを防ぐ
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        {...props}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setLocal(next)
          // 変換未確定中は親へ流さない（compositionend でまとめて確定）
          if (composingRef.current) return
          scheduleCommit(next)
        }}
        onInput={onInput}
        onCompositionStart={(e) => {
          composingRef.current = true
          clearTimer()
          onCompositionStart?.(e)
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          const next = e.currentTarget.value
          setLocal(next)
          scheduleCommit(next)
          onCompositionEnd?.(e)
        }}
        onFocus={(e) => {
          focusedRef.current = true
          onFocus?.(e)
        }}
        onBlur={(e) => {
          focusedRef.current = false
          composingRef.current = false
          commit(e.currentTarget.value)
          onBlur?.(e)
        }}
      />
    )
  },
)
