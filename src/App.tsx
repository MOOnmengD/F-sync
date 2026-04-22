import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DrawerNav } from './layout/DrawerNav'
import Home from './pages/Home'
import Finance from './pages/Finance'
import Whisper from './pages/Whisper'
import Work from './pages/Work'
import Vault from './pages/Vault'
import Timeline from './pages/Timeline'
import Login from './pages/Login'
import Chat from './pages/Chat'
import { supabase } from './supabaseClient'

export default function App() {
  const { pathname } = useLocation()
  const [sessionReady, setSessionReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)

  // 监听主动消息，触发 HarmonyOS 原生通知
  useEffect(() => {
    const client = supabase
    console.log('[HarmonyNotif] init, supabase available:', !!client)
    if (!client) return
    const channel = client
      .channel('harmony-proactive-notif')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new as { client_id?: string; content?: string }
          console.log('[HarmonyNotif] INSERT event, client_id:', msg?.client_id)
          if (msg?.client_id?.startsWith('proactive-') && msg.content) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const harmonyNative = (window as any).harmonyNative
            console.log('[HarmonyNotif] harmonyNative available:', !!harmonyNative?.receiveMessage)
            if (harmonyNative?.receiveMessage) {
              harmonyNative.receiveMessage(JSON.stringify({
                type: 'showNotification',
                data: { title: '弗弗', content: msg.content }
              }))
              console.log('[HarmonyNotif] receiveMessage called')
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('[HarmonyNotif] subscription status:', status)
      })
    return () => { void client.removeChannel(channel) }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) {
      setSessionReady(true)
      setSession(null)
      return
    }

    let active = true
    void client.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session ?? null)
      setSessionReady(true)
    })

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const clientConfigured = Boolean(supabase)
  const authed = Boolean(session)
  const isLogin = pathname === '/login'

  if (clientConfigured && !sessionReady) {
    return (
      <div className="mx-auto min-h-dvh max-w-[480px] bg-base-bg px-4 py-10 text-base-text">
        <div className="rounded-2xl border border-base-line bg-base-surface p-4 text-sm">
          正在初始化…
        </div>
      </div>
    )
  }

  if (clientConfigured && !authed && !isLogin) {
    return <Navigate to="/login" replace />
  }

  if (clientConfigured && authed && isLogin) {
    return <Navigate to="/" replace />
  }

  return (
    <>
      {clientConfigured && !authed ? null : <DrawerNav />}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/whisper" element={<Whisper />} />
        <Route path="/work" element={<Work />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
