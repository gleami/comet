# Comet Design Handoff

- Change: online-self-update
- Phase: design
- Mode: compact
- Context hash: 6b36a9737edc8c9e2fda1a26e5e97e253ac4f74e3e9ec0adef72d96c04204fb9

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/online-self-update/proposal.md

- Source: openspec/changes/online-self-update/proposal.md
- Lines: 1-40
- SHA256: 032dc8f4d5a02854e4774969ede086e44de264d4cd2bda2a1a7961e42db53d90

```md
# 在线升级功能

## 问题背景

当前 Comet 提供了 `comet update` 命令用于升级自身，但存在以下不足：

1. **无版本检查**：用户需要手动运行 `comet update` 才能知道是否有新版本，无法主动获知更新
2. **无更新通知**：CLI 启动时不会检查 npm registry 上是否有更新的版本
3. **无自动检查机制**：即使有新版发布，用户也不会收到提醒
4. **npm registry 不存在时处理不优雅**：如果包尚未发布到 npm registry，npm update 会失败且没有友好的降级处理
5. **无版本对比功能**：`comet --version` 只能显示当前版本，无法告知用户最新版本

## 目标

- 为 Comet CLI 增加在线版本检查能力（对比 npm registry）
- 在特定时机（CLI 启动、用户主动查询）展示更新通知
- 改进 `comet update` 的健壮性和用户体验
- 支持可配置的更新检查策略（自动/手动/关闭）

## 范围

- **包含**：
  - npm registry 版本查询模块
  - 启动时可选检查最新版本
  - "有新版本可用"的通知展示
  - `comet update` 命令增强（版本对比 + 更清晰的升级流程）
  - 配置选项（检查频率、启用/禁用）

- **不包含**：
  - 自动后台更新（仅在用户确认后执行实际更新）
  - 非 npm 渠道的升级（如 Homebrew、源码编译等）
  - 旧版本迁移脚本

## 验收标准

1. 运行 `comet update --check` 可查询最新版本并对比当前版本
2. CLI 启动时（可配置）提示有新版本可用
3. 升级流程清晰：显示当前版本 → 最新版本 → 变更摘要 → 确认升级
4. 当包尚未发布到 npm registry 时，给出明确提示而非报错
5. 配置项支持关闭自动检查
```

## openspec/changes/online-self-update/design.md

- Source: openspec/changes/online-self-update/design.md
- Lines: 1-60
- SHA256: 9fbeef005f8cfb745f43e9fc78894a91b1562416a2568777cb986a02bd56b2d8

```md
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
```

## openspec/changes/online-self-update/tasks.md

- Source: openspec/changes/online-self-update/tasks.md
- Lines: 1-8
- SHA256: 054eeb49ac1c3b110d058ac7187985ee31f5145d20856effe3008902e9a9f226

```md
# 在线升级功能 - 任务列表

## 任务

- [x] **创建 version-check.ts 模块**: 实现 npm registry 版本查询和版本比较
- [x] **增强 update.ts**: 新增 --check 选项，集成版本检查流程
- [x] **注册 --check 选项**: 在 CLI 入口注册新的选项
- [x] **编写单元测试**: 覆盖版本检查、配置读写、命令增强
- [ ] **更新 CHANGELOG**: 由维护者编写```

