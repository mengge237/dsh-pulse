// 从 dsh-compaction-meter 0.3.0 并进来的会话投影（2026-10-20 合并，本人批准）。
//
// 为什么搬而不是留两个：压缩计数原本由 compaction-meter 算并落投影，再由 dsh-pulse
// 读同一份投影画状态条 —— 一个数跨两个插件、其中渲染那半边从 09-16 起就没长出来，
// 属于"半死插件 + 同一功能两处代码"。合并后一格三数（压缩/闸/改动）同源同版本。
//
// 铁律：**key 必须仍叫 compactionMeter**。历史计数存在
// ~/.dsh/storages/session_projcache 的 record.rows.compactionMeter 下，改名会让所有
// 已有会话的累计数归零。
//
// stateVersion 保持 3：注册表见到 ver !== stateVersion 会丢掉缓存行整段重折
// （dsh-session-projection/lib/index.js:228），所以老会话照样现算。
// 上游 0.1.5-rc.1 读 stateSchema + wire{viewSchema,view}；少了 wire 就成"宿主内单元"，
// 值永不上浏览器 —— 这正是 09-16 那格没长出来的真因，别删 wire。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const GUARD_FILE = path.join(DSH_HOME, 'compaction-guard.json')
const DEFAULT_WARN = 3
const DEFAULT_HARD = 6

function readGuard() {
  const fallback = { warn: DEFAULT_WARN, hard: DEFAULT_HARD }
  let parsed
  // 坑：PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM，JSON.parse 直接抛。
  try { parsed = JSON.parse(fs.readFileSync(GUARD_FILE, 'utf8').replace(/^\uFEFF/, '')) } catch { return fallback }
  const positive = (v, d) => (Number.isSafeInteger(v) && v > 0 ? v : d)
  const warn = positive(parsed && parsed.warn, DEFAULT_WARN)
  let hard = positive(parsed && parsed.hard, DEFAULT_HARD)
  if (hard < warn) hard = warn
  return { warn, hard }
}

const viewSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('compactionMeter view 不是对象')
    for (const k of ['compactions', 'compactionFailures', 'counted']) {
      if (!Number.isSafeInteger(value[k]) || value[k] < 0) throw new Error('compactionMeter.' + k + ' 非法')
    }
    if (value.counted !== Math.max(value.compactions, value.compactionFailures)) throw new Error('compactionMeter.counted 与成功/失败数不一致')
    for (const k of ['lastAt', 'lastFailureAt']) {
      if (!(value[k] === null || Number.isFinite(value[k]))) throw new Error('compactionMeter.' + k + ' 非法')
    }
    if (!Number.isSafeInteger(value.warn) || !Number.isSafeInteger(value.hard) || value.hard < value.warn) throw new Error('compactionMeter 阈值非法')
    return value
  },
}

const stateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('compactionMeter state 不是对象')
    for (const k of ['compactions', 'compactionFailures']) {
      if (!Number.isSafeInteger(value[k]) || value[k] < 0) throw new Error('compactionMeter.' + k + ' 非法')
    }
    for (const k of ['lastAt', 'lastFailureAt']) {
      if (!(value[k] === null || Number.isFinite(value[k]))) throw new Error('compactionMeter.' + k + ' 非法')
    }
    return value
  },
}

export const KEY = 'compactionMeter'

// 判级输入 counted = max(成功数, 失败数)：摘要太多会让记忆退化成转述，压缩连败说明这条
// 会话已经压不动 —— 两条都该喊人换会话。规则与 compact_check.py 的 judged() 同一条。
function view(state) {
  const g = readGuard()
  return {
    compactions: state.compactions,
    compactionFailures: state.compactionFailures,
    counted: Math.max(state.compactions, state.compactionFailures),
    lastAt: state.lastAt,
    lastFailureAt: state.lastFailureAt,
    warn: g.warn,
    hard: g.hard,
  }
}

export const compactionMeterDefinition = {
  key: KEY,
  stateVersion: 3,
  schema: viewSchema,
  stateSchema,
  init: () => ({ compactions: 0, compactionFailures: 0, lastAt: null, lastFailureAt: null }),
  apply(state, event) {
    // 无关事件必须返回同一引用：注册表按 Object.is 决定要不要往下推。
    if (event.type === 'compaction/summary') {
      return { ...state, compactions: state.compactions + 1, lastAt: event.time ?? state.lastAt }
    }
    if (event.type === 'compaction/end' && event.data && event.data.error) {
      return { ...state, compactionFailures: state.compactionFailures + 1, lastFailureAt: event.time ?? state.lastFailureAt }
    }
    return state
  },
  view,
  wire: { viewSchema, view },
}
