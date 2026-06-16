/**
 * MiniMax 音色快速复刻脚本
 *
 * 用法: node scripts/clone-voice.mjs
 *
 * 流程:
 *   1. 上传复刻源音频 → 获取 file_id
 *   2. 调用 voice_clone → 返回 demo_audio 试听链接
 *   3. 复刻完成后，在 TTS 接口中使用自定义 voice_id
 */

const API_KEY = process.env.MINIMAX_API_KEY
const AUDIO_PATH = 'D:\\edgedownload\\hsbeu-5hui6-001.m4a'
const VOICE_ID = 'xmz-minimax-voice'
const BASE_URL = 'https://api.minimaxi.com/v1'

if (!API_KEY) {
  console.error('❌ 请设置 MINIMAX_API_KEY 环境变量')
  process.exit(1)
}

const AUTH_HEADER = { Authorization: `Bearer ${API_KEY}` }

async function main() {
  // ========== Step 1: 上传复刻源音频 ==========
  console.log('📤 Step 1: 上传复刻源音频...')

  const { readFileSync } = await import('fs')
  const fileBuffer = readFileSync(AUDIO_PATH)
  const fileName = AUDIO_PATH.split('\\').pop()

  const formData = new FormData()
  formData.append('purpose', 'voice_clone')
  formData.append('file', new Blob([fileBuffer], { type: 'audio/m4a' }), fileName)

  const uploadRes = await fetch(`${BASE_URL}/files/upload`, {
    method: 'POST',
    headers: AUTH_HEADER,
    body: formData,
  })

  const uploadJson = await uploadRes.json()
  console.log('   Status:', uploadRes.status)
  console.log('   Response:', JSON.stringify(uploadJson, null, 2))

  if (!uploadRes.ok || uploadJson.base_resp?.status_code !== 0) {
    console.error('❌ 上传失败')
    process.exit(1)
  }

  const fileId = uploadJson.file?.file_id
  console.log(`✅ 上传成功，file_id = ${fileId}`)

  // ========== Step 2: 执行音色复刻 ==========
  console.log('\n🎤 Step 2: 执行音色复刻...')

  const cloneBody = {
    file_id: fileId,
    voice_id: VOICE_ID,
    model: 'speech-2.8-hd',
    text: '你好，这是我的定制音色，听起来自然吗？',
    language_boost: 'auto',
    need_noise_reduction: false,
    need_volume_normalization: true,
  }

  console.log('   Request:', JSON.stringify(cloneBody, null, 2))

  const cloneRes = await fetch(`${BASE_URL}/voice_clone`, {
    method: 'POST',
    headers: {
      ...AUTH_HEADER,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cloneBody),
  })

  const cloneJson = await cloneRes.json()
  console.log('   Status:', cloneRes.status)
  console.log('   Response:', JSON.stringify(cloneJson, null, 2))

  if (!cloneRes.ok || cloneJson.base_resp?.status_code !== 0) {
    console.error('❌ 复刻失败')
    process.exit(1)
  }

  console.log(`\n✅ 音色复刻成功！`)
  console.log(`   voice_id: ${VOICE_ID}`)
  if (cloneJson.demo_audio) {
    console.log(`   demo 试听: ${cloneJson.demo_audio}`)
  }
  if (cloneJson.extra_info) {
    console.log(`   信息:`, cloneJson.extra_info)
  }
}

main().catch((err) => {
  console.error('❌ 脚本异常:', err.message)
  process.exit(1)
})
