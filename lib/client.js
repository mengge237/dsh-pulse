// dsh-pulse —— 浏览器半边：对话框下方统计条同一槽位多一格纪律读数
//
// 形态照 dsh-compaction-meter / dsh-skill-meter：本文件是宿主模块图里的一个 bundle
// （exports["./client"]），require 拿到的是宿主那份 react，不是 node_modules。
// 挂载点 conversation.composer.dock 正是上游统计条自己的槽。
//
// 行为：只读 GET /dsh-pulse/report.json（每 30 秒，切走就停）；
//       点击那一格 = POST /dsh-pulse/run（按配置跑命令集并落产出），跑完重读。
// 视觉值只用宿主令牌，不写死颜色：十六进制色值、rgb 与 hsl 函数一个都不许出现
// （写成中文省得源码级闸把自己注释里的示例当成违规，10-15 假红一次）。

window.__ModuleLoader__.load({
  id: 'dsh-pulse',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement

    var inject = ['slots']
    var SLOT = 'conversation.composer.dock'
    var API = '/dsh-pulse/report.json'
    var RUN = '/dsh-pulse/run'

    var COLOR = {
      ok: 'var(--dsw-alias-label-secondary)',
      warn: 'var(--dsw-alias-state-warn)',
      hard: 'var(--dsw-alias-state-error)',
      unknown: 'var(--dsw-alias-label-tertiary)'
    }

    function label(snap) {
      if (!snap) return '纪律 …'
      var c = snap.compaction || {}
      var cTxt = c.count === null || c.count === undefined ? '压缩 ?' : '压缩 ' + c.count + '/' + c.hard
      var g = snap.gates
      var gTxt = g && g.gates && g.gates.length
        ? '闸 ' + g.gates.filter(function (x) { return x.ok }).length + '/' + g.gates.length
        : '闸 未跑'
      var dTxt = snap.dirty === null || snap.dirty === undefined ? '改动 ?' : '改动 ' + snap.dirty
      return cTxt + ' · ' + gTxt + ' · ' + dTxt
    }

    function tip(snap) {
      if (!snap) return '纪律读数载入中'
      var lines = ['压缩判级：' + ((snap.compaction && snap.compaction.state) || '?') + '（warn ' + snap.compaction.warn + ' / hard ' + snap.compaction.hard + '）']
      if (snap.compaction && snap.compaction.session) lines.push('最近会话：' + snap.compaction.session)
      if (snap.gates && snap.gates.at) lines.push('四闸读数时刻：' + snap.gates.at)
      if (snap.gates && snap.gates.gates) snap.gates.gates.forEach(function (x) { lines.push((x.ok ? '✔ ' : '✘ ') + x.name + (x.ms ? ' ' + x.ms + 'ms' : '')) })
      lines.push('工作区：' + (snap.workdir || '-'))
      lines.push('点击 = 跑一次配置里的命令并落产出（~/.dsh/discipline/）')
      return lines.join('\n')
    }

    function Cell(props) {
      var pair = react.useState(null)
      var snap = pair[0], setSnap = pair[1]
      var busyPair = react.useState(false)
      var busy = busyPair[0], setBusy = busyPair[1]

      react.useEffect(function () {
        var alive = true
        var load = function () {
          fetch(API, { credentials: 'same-origin' })
            .then(function (r) { return r.json() })
            .then(function (j) { if (alive) setSnap(j && j.ok ? j : null) })
            .catch(function () {})
        }
        load()
        var timer = setInterval(load, 30000)
        return function () { alive = false; clearInterval(timer) }
      }, [])

      var onRun = function () {
        if (busy) return
        setBusy(true)
        fetch(RUN, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
          .then(function () { return fetch(API, { credentials: 'same-origin' }).then(function (r) { return r.json() }) })
          .then(function (j) { if (j && j.ok) setSnap(j) })
          .catch(function () {})
          .then(function () { setBusy(false) })
      }

      var state = snap && snap.compaction ? snap.compaction.state : 'unknown'
      var style = {
        marginLeft: '10px',
        color: COLOR[state] || COLOR.unknown,
        cursor: 'pointer',
        font: 'var(--dsw-font-xxxs-strong-11)',
        userSelect: 'none',
        whiteSpace: 'nowrap'
      }
      return h('span', { style: style, title: tip(snap), onClick: onRun, 'data-dsh-plugin': 'dsh-pulse' },
        busy ? '纪律 跑…' : label(snap))
    }

    function apply(ctx) {
      ctx.slots.inject(SLOT, function () {
        // 2026-10-16：name 必须与 inject 的槽同名，写 'discipline' 会被宿主拒
        // （slot "discipline" is not declared —— 那一格永远挂不上，只在控制台留一条 pageerror）
        return ctx.slots.register({ name: SLOT, id: 'dsh-pulse:cell', order: 6, label: '纪律' }, Cell)
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
