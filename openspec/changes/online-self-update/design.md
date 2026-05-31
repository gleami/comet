# 在线升级功能 - 高层设计

## 方案选择

### 版本检查方式

**方案 A**: npm registry API 查询
- 优点: 无需认证、实现简单、是标准做法
- 缺点: 依赖 npm registry 可用性

**方案 B**: GitHub Releases API
- 优点: 可以获取 release notes
- 缺点: 需要 GitHub token（否则有 rate limit）

**选择: 方案 A** — npm registry 查询已足够满足需求，简单可靠

### 检查时机

| 策略 | 行为 |
|------|------|
| `never` | 从不自动检查（默认） |
| `daily` | 每天检查一次（缓存 24h） |
| `always` | 每次 CLI 启动检查 |

**默认: `never`** — 不增加启动延迟，用户需要时通过 `comet update --check` 主动检查

### 更新流程

1. 用户运行 `comet update`（或 `comet update --check`）
2. 查询 npm registry 获取最新版本
3. 对比当前版本
4. 如有更新，展示版本对比 + 最近 3 条 changelog 条目
5. 询问是否执行升级（仅 `comet update` 时）
6. 升级：npm install → 更新技能文件

## 模块职责

```
src/
  commands/
    update.ts           ← 增强：新增 --check 选项，优化升级流程
  core/
    version-check.ts    ← 新增：npm registry 版本检查
    comet-config.ts     ← 新增：配置文件读写
```

### version-check.ts
- `fetchLatestVersion()`: 请求 npm registry，返回最新版本号
- `compareVersions(v1, v2)`: 语义化版本比较（返回 -1/0/1）
- 异常处理：网络错误、JSON 解析错误、registry 不可达

### comet-config.ts
- 配置文件: `~/.config/comet/config.json`
- `loadConfig()`: 读取配置，不存在则返回默认值
- `saveConfig(config)`: 写入配置
- 配置字段: `updateCheck`、`lastCheckTime`、`cachedLatestVersion`

### update.ts 增强
- 新增 `--check` 选项：仅检查版本，不执行更新
- 主流程增加：版本检查 → 对比 → 显示变更摘要 → 确认 → 升级
