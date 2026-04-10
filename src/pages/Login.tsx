import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function Login() {
  const client = supabase
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const redirectTo = useMemo(() => `${window.location.origin}/login`, [])

  useEffect(() => {
    if (!client) {
      setHasSession(false)
      setChecking(false)
      return
    }

    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setErrorText(error.message || '获取登录态失败')
      setHasSession(Boolean(data.session))
      setChecking(false)
    })

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session))
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [client])

  if (checking) {
    return (
      <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 py-10 text-base-text">
        <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm">
          正在检查登录态…
        </div>
      </div>
    )
  }

  if (hasSession) return <Navigate to="/" replace />

  const signIn = async () => {
    if (!client) {
      setErrorText('未配置 Supabase URL/Key')
      return
    }

    setErrorText(null)
    const { error } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo },
    })
    if (error) setErrorText(error.message || '发起 GitHub 登录失败')
  }

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 py-10 text-base-text">
      <div className="rounded-3xl border border-base-line bg-base-surface p-5">
        <div className="text-base font-medium">登录</div>
        <div className="mt-2 text-sm text-base-subtle">
          需要先登录才能读写 Supabase（已开启 RLS）。
        </div>

        <button
          type="button"
          className="mt-5 w-full rounded-2xl border border-base-line bg-pastel-baby px-4 py-3 text-sm font-medium text-base-text"
          onClick={() => void signIn()}
        >
          使用 GitHub 登录
        </button>

        {errorText ? (
          <div className="mt-3 rounded-2xl border border-base-line bg-white px-3 py-2 text-sm text-red-700">
            {errorText}
          </div>
        ) : null}

        <div className="mt-4 text-xs text-base-subtle">
          首次接入需要在 Supabase Auth 里启用 GitHub Provider，并把 Redirect URL 加上：{redirectTo}
        </div>
      </div>
    </div>
  )
}

