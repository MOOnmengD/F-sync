import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 永久开启局域网访问了
  server: {
    host: '0.0.0.0', // 暴露局域网
    port: 5173,      // 固定端口，不自动变化
    strictPort: true // 端口被占用时报错，不自动换
  }
})

