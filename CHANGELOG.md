# 更新日志

## 0.1.1 — 2026-10-20

- **改名**：`dsh-discipline` → `dsh-pulse`（中文名「本机脉象」）。改的是包名、路由（`/dsh-pulse/*`）、仓库名与目录；**数据目录仍是 `~/.dsh/discipline/`**，配置与闸缓存不受影响。
- 旧路由 `/dsh-discipline/report.json` 与 `/run` 保留为只转发的别名，避免改名后没刷新的页面显示 `压缩 ?`。

## 0.1.0 — 2026-10-20

- 把 `dsh-compaction-meter` 的会话投影（`stateSchema` + `wire{viewSchema,view}` + `apply/view`）并进本包，**投影 key 仍是 `compactionMeter`**（改名会让已有会话的累计数归零），`stateVersion` 保持 3。
- `dsh-compaction-meter` 随之停用；一格三数（压缩 / 闸 / 改动）从此同源同版本。
