import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const embeddingKey = env.EMBEDDING_API_KEY || ''

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'https://www.fsync.top',
          changeOrigin: true
        },
        '/embedding-api': {
          target: 'https://api.siliconflow.cn',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/embedding-api/, '/v1'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (embeddingKey) {
                proxyReq.setHeader('Authorization', `Bearer ${embeddingKey}`)
              }
            })
          }
        }
      }
    }
  }
})
