// dsh-pulse —— 宿主半边：把本机纪律做成两条可读数的口
//
// 为什么要有它：纪律（压缩判级 / 四闸 / 未提交改动）原本散在脚本里，靠人记得跑
// —— "靠自觉"就是假闸。这里把它固定成：一格常驻读数 + 一次点击产出。
//
// 路由（裸路由：宿主鉴权不覆盖插件动态注册的通道，所以自己过来源栅栏）：
//   GET  /dsh-pulse/report.json  现算轻量态（压缩判级 / 闸缓存 / 未提交改动）
//   POST /dsh-pulse/run          按配置跑命令集，写 md+json 产出
//
// 配置：~/.dsh/discipline/config.json
//   {"workdir":"E:\\...","commands":[{"name":"四闸","cmd":"...","timeoutMs":600000}]}
// 产出：~/.dsh/discipline/last-report.json、纪律报告-<时间戳>.md、gates.json
//
// 安装：dsh plugin --profile web add "<本目录>"；卸载：... remove dsh-pulse
// 改本文件（服务端半边）要重启 dsh web 才装载；改 lib/client.js 刷新页面即可。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { compactionMeterDefinition } from './compaction.js'

export const name = 'dsh-pulse'
// sessionProjections：压缩计数由本插件自己注册投影（2026-10-20 从 dsh-compaction-meter 并进来，
// key 仍是 compactionMeter），不再依赖另一个插件供数。
export const inject = ['webServer', 'sessionProjections']

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const DIR = path.join(DSH_HOME, 'discipline')
const CFG_PATH = path.join(DIR, 'config.json')
const LAST_PATH = path.join(DIR, 'last-report.json')
const GATES_PATH = path.join(DIR, 'gates.json')
const GUARD_PATH = path.join(DSH_HOME, 'compaction-guard.json')
const PROJCACHE = path.join(DSH_HOME, 'storages', 'session_projcache', 'sessions')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
const MAX_BODY = 64 * 1024
const RUN_TIMEOUT_MS = 15 * 60 * 1000

/** 来源栅栏：只认 loopback 且非同站跨域（照 dsh-plugin-dev 的判据；别带 CORS 头）。 */
function fence(req) {
  const host = String(req.headers.host || '')
  const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return 'host'
  if (String(req.headers['sec-fetch-site'] || '') === 'cross-site') return 'sec-fetch-site'
  const origin = String(req.headers.origin || '')
  if (origin) {
    let oh = ''
    try { oh = new URL(origin).host } catch { return 'origin' }
    if (oh !== host) return 'origin'
  }
  return null
}

function send(res, code, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(code, JSON_HEADERS)
  res.end(body)
}

function readJson(file, fallback = null) {
  // 坑（10-15 实踩）：PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM，
  // JSON.parse 遇到 BOM 直接抛 —— 不剥 BOM 就是「配置文件明明在，却静默读成默认值」。
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return fallback }
}

function readGuard() {
  const g = readJson(GUARD_PATH, {}) || {}
  const warn = Number.isFinite(g.warn) ? Number(g.warn) : 3
  const hard = Number.isFinite(g.hard) ? Number(g.hard) : 6
  return { warn, hard }
}

/**
 * 取压缩计数。形状（10-15 从投影缓存实读，别再遍历猜）：
 *   rows.compactionMeter = {ver, seq, val:{compactions, compactionFailures, lastAt, lastFailureAt}}
 * 取「最近一条有压缩记录的会话」，都没有就退回最新一条。
 */
function latestCompaction() {
  let files = []
  try {
    files = fs.readdirSync(PROJCACHE).filter((f) => f.endsWith('.json'))
      .map((f) => {
        const p = path.join(PROJCACHE, f)
        let mtimeMs = 0
        try { mtimeMs = fs.statSync(p).mtimeMs } catch {}
        return { p, mtimeMs }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 40)
  } catch { return null }
  const SIX_H = 6 * 60 * 60 * 1000
  const now = Date.now()
  let newest = null
  let worst = null
  for (const f of files) {
    const doc = readJson(f.p, null)
    const v = doc && doc.record && doc.record.rows && doc.record.rows.compactionMeter
    const val = v && v.val
    if (!val || typeof val.compactions !== 'number') continue
    const item = { session: path.basename(f.p, '.json'), count: val.compactions, fails: Number(val.compactionFailures) || 0, lastAt: val.lastAt || null, at: f.mtimeMs }
    if (!newest) newest = item
    if (now - f.mtimeMs <= SIX_H && (!worst || item.count > worst.count)) worst = item
  }
  if (!newest) return null
  // 宿主侧不知道「当前会话」是哪条（URL 里没有会话 id），所以取最近 6 小时内**压缩最多**
  // 的那条当读数（最坏值更合适：这一格的用途是在压过头之前提醒），并附上最新一条做对照。
  const pick = worst && worst.count >= newest.count ? worst : newest
  return Object.assign({}, pick, { windowH: 6, newestSession: newest.session, newestCount: newest.count })
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ err, out: String(stdout || '') + String(stderr || '') })
    })
  })
}

async function dirtyCount(workdir) {
  if (!workdir || !fs.existsSync(workdir)) return null
  const { err, out } = await run('git', ['status', '--porcelain'], { cwd: workdir, timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  if (err && !out) return null
  return out.split('\n').filter((l) => l.trim()).length
}

function readGates() {
  const g = readJson(GATES_PATH, null)
  if (!g || !Array.isArray(g.gates)) return null
  return g
}

function readConfig() {
  const c = readJson(CFG_PATH, null)
  if (c && typeof c === 'object') return c
  return { workdir: process.env.DSH_WORKSPACE || process.cwd(), commands: [] }
}

async function snapshot() {
  const cfg = readConfig()
  const guard = readGuard()
  const comp = latestCompaction()
  const dirty = await dirtyCount(cfg.workdir)
  const gates = readGates()
  const count = comp ? comp.count : null
  const state = count === null ? 'unknown' : count >= guard.hard ? 'hard' : count >= guard.warn ? 'warn' : 'ok'
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    workdir: cfg.workdir || null,
    compaction: { count, fails: comp ? comp.fails : null, session: comp ? comp.session : null, ...guard, state },
    dirty,
    gates,
    lastRun: readJson(LAST_PATH, null),
    commands: (cfg.commands || []).map((c) => c.name)
  }
}

async function runCommands() {
  const cfg = readConfig()
  const results = []
  for (const c of cfg.commands || []) {
    const started = Date.now()
    const { err, out } = await run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', String(c.cmd)], {
      cwd: cfg.workdir || process.cwd(), timeout: Number(c.timeoutMs) || RUN_TIMEOUT_MS,
      windowsHide: true, maxBuffer: 8 * 1024 * 1024
    })
    const tail = out.split('\n').map((l) => l.trim()).filter(Boolean).slice(-3).join(' ｜ ')
    results.push({ name: c.name, ok: !err, code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0), ms: Date.now() - started, tail: tail.slice(0, 400) })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const report = { ok: results.every((r) => r.ok), generatedAt: new Date().toISOString(), workdir: cfg.workdir || null, results }
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(LAST_PATH, JSON.stringify(report, null, 2), 'utf8')
    fs.writeFileSync(GATES_PATH, JSON.stringify({ at: report.generatedAt, gates: results.map((r) => ({ name: r.name, ok: r.ok, line: r.tail, ms: r.ms })) }, null, 2), 'utf8')
    const md = ['# 纪律报告 ' + report.generatedAt, '', '工作区：' + (report.workdir || '-'), '']
      .concat(results.map((r) => '- ' + (r.ok ? '通过' : '失败') + ' ｜ ' + r.name + ' ｜ ' + r.ms + 'ms ｜ ' + r.tail))
      .join('\n')
    fs.writeFileSync(path.join(DIR, '纪律报告-' + stamp + '.md'), md + '\n', 'utf8')
  } catch (e) {
    report.writeError = String(e && e.message || e)
  }
  return report
}

/** 装配：注册两条路由 + 压缩计数投影。 */
export function apply(ctx) {
  ctx.sessionProjections.register(compactionMeterDefinition)
  const disposers = []
  disposers.push(ctx.webServer.register({
    method: 'GET',
    path: '/' + name + '/report.json',
    async handler(req, res) {
      const why = fence(req)
      if (why) return send(res, 403, { ok: false, error: 'forbidden', why })
      try { send(res, 200, await snapshot()) } catch (e) { send(res, 500, { ok: false, error: String(e && e.message || e) }) }
    }
  }))
  disposers.push(ctx.webServer.register({
    method: 'POST',
    path: '/' + name + '/run',
    async handler(req, res) {
      const why = fence(req)
      if (why) return send(res, 403, { ok: false, error: 'forbidden', why })
      let n = 0
      req.on('data', (chunk) => { n += chunk.length; if (n > MAX_BODY) req.destroy() })
      req.on('end', async () => {
        try { send(res, 200, await runCommands()) } catch (e) { send(res, 500, { ok: false, error: String(e && e.message || e) }) }
      })
    }
  }))
  ctx.effect(() => () => { for (const d of disposers) { try { typeof d === 'function' ? d() : d && d.dispose && d.dispose() } catch {} } })
}

export const internals = { fence, readGuard, latestCompaction, dirtyCount, readConfig, snapshot, runCommands, DIR }
