import { Routes, Route, Navigate } from 'react-router-dom'
import { DrawerNav } from './layout/DrawerNav'
import Home from './pages/Home'
import Finance from './pages/Finance'
import Whisper from './pages/Whisper'
import Work from './pages/Work'
import Vault from './pages/Vault'

export default function App() {
  return (
    <>
      <DrawerNav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/finance" element={<Finance />} />
        <Route path="/whisper" element={<Whisper />} />
        <Route path="/work" element={<Work />} />
        <Route path="/vault" element={<Vault />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
