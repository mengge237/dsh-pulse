# dsh-pulse

本机脉象：把压缩判级、四道机械闸、未提交改动做成 DSH 统计条上的一格常驻读数，点一下按配置跑命令集并把报告落成 md + json。

![状态条那格：压缩 1/6 · 闸 3/4 · 改动 2](docs/demo.gif)

*真机截图：`压缩 1/6`（判级数 / hard 阈值）、`闸 3/4`（四道机械闸过了 3 道）、`改动 2`（未提交改动数）。*

![GET /dsh-pulse/report.json 的返回](docs/screenshot.png)

## 它解决什么

纪律（压缩判级 / 四闸 / 未提交改动）原先散在脚本里，靠人记得跑 —— 靠自觉就是假闸。
这个插件把三件事钉进宿主：**看得见**（统计条一格）、**点得动**（一键跑命令集）、**有产出**（md + json 落盘）。

## 安装 / 卸载

```bash
dsh plugin --profile web add "E:/S_Software/deepseek-harness/plugins/dsh-pulse"
dsh plugin --profile web remove dsh-pulse
```

- 只改客户端半边（`lib/client.js`）：刷新页面即可。**改 `lib/index.js` 或新增客户端入口要重启 `dsh web`**（服务端半边是启动时 import 的）。
- 数据目录是 `~/.dsh/discipline/`（配置与闸缓存都在里面，改路径等于把它们丢掉）。

## 配置 `~/.dsh/discipline/config.json`

```json
{
  "workdir": "E:\\S_Software\\pl-studio",
  "commands": [
    { "name": "结构闸", "cmd": "python docs\\probe-结构完整性.py", "timeoutMs": 300000 }
  ]
}
```

每条 `cmd` 在 `workdir` 下用 `cmd /d /s /c` 执行，`ok` 只看退出码。
**写这个文件要剥 BOM**：PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，`JSON.parse` 遇 BOM 直接抛，表现是「文件明明在却读成默认值」。

## 两条路由（裸路由，自过来源栅栏：只认 loopback、非同站跨域）

| 路由 | 作用 |
|---|---|
| `GET /dsh-pulse/report.json` | 现算轻量态：压缩判级、闸缓存、未提交改动、配置里的命令名 |
| `POST /dsh-pulse/run` | 按配置跑命令集，写 `last-report.json`、`gates.json`、`纪律报告-<时间戳>.md` |

旧名 `dsh-discipline` 的两条路由保留为**只转发的别名**，兜住改名后没刷新的旧标签页；观察一段时间后可删。

## 这个数写在哪儿

- `压缩 ?`：取不到数据 —— 本会话没有压缩记录，或投影还没折叠完。
- 投影形状 `rows.compactionMeter = {ver, seq, val:{compactions, compactionFailures, lastAt, lastFailureAt}}`。
- `闸 未跑`：还没点过那一格；`ok` 只认退出码 0。

## 视觉约束

颜色只用宿主令牌（`--dsw-alias-*` / `--dsw-font-*`），不写死色值 —— 源码级闸会拦 `#hex` / `rgb(` / `hsl(`。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。
