# 萌友星球发布就绪核查

目标：面向真实玩家注册使用前，确认功能、数据、安全和发布路径都有可重复证据。

## 本机必过门禁

上线前先运行：

```bash
npm run release:check
```

Docker daemon 可用时，最终上线前运行更完整的一键门禁：

```bash
npm run release:full
```

该命令会串行覆盖：

- `npm run audit:readiness`：检查关键文件、需求清单、README 承诺、Docker/Compose 配置、CI 工作流、无本地 `data/` 残留。
- `npm run verify:clean-data`：独立检查本地 `data/` 没有账号、存档、聊天、停车或上传图片残留，并确认 Git/Docker 忽略规则排除了 `data/`。
- `npm run verify:install`：检查 lockfile 能通过 `npm ci` 干净安装。
- `npm run verify:secrets`：扫描仓库中高置信度明文密钥形态，避免把 private key 或常见 API token 提交进发布包。
- `npm run verify:dependencies`：检查生产依赖没有高危或严重漏洞。
- `npm run lint`：静态代码检查。
- `npm run build`：TypeScript 和 Vite 生产构建。
- `npm run verify`：API 层双玩家注册登录、服务端权威结算、上传、社交、停车、任务、安全头、错误方法、限流、备份恢复等。
- `npm run verify:journey`：第一天玩家旅程，覆盖注册、照片上传、照顾、商店、学习、工作、城市聊天、真实好友、农场、赠礼、停车、任务和重置清理。
- `npm run verify:ui`：生产包移动端真实界面交互，覆盖注册、上传、照片生成、商店、城市、真实好友、农场、赠礼、停车、学习、工作、任务、退出登录、重新登录和重置确认。
- `npm run verify:docker-context`：确认 Docker 构建上下文不会包含 `data/`、`dist/`、`node_modules/`、Git 元数据、`.env` 或 `progress.md`。
- 生产 smoke：用临时 `DATA_DIR` 启动生产服务，检查 `GET/HEAD /api/health`、首页 HTML、JS/CSS/icon 静态资源状态、content type、`nosniff`、生产模式真实注册、会话恢复和 `moyo-db.json` 持久化。

## CI 或部署机必过门禁

Docker daemon 可用的环境还必须运行：

```bash
npm run verify:docker-build
npm run verify:docker-runtime
```

该命令会执行：

- `docker compose config`
- `docker build -t moyo-planet:verify-<pid> .`

`npm run verify:docker-runtime` 还会执行：

- 构建 Docker 镜像
- 以临时宿主数据目录挂载容器 `/data`
- 访问容器生产首页和 `/api/health`
- 在容器里真实注册玩家并恢复 session
- 检查宿主数据目录落盘 `moyo-db.json`，且用户密码使用 PBKDF2 存储

本机如果 Docker daemon 未启动，该命令会失败并明确报告 socket/daemon 原因；这不是代码通过证据。真实发布前应在 GitHub Actions 或部署机上取得通过结果。

`.github/workflows/release-check.yml` 已配置在 push 和 pull request 中运行：

- `npm ci`
- `npm run release:check`
- `npm run verify:docker-build`
- `npm run verify:docker-runtime`

## 数据与部署要求

- 生产必须设置 `DATA_DIR`，并挂载到持久化磁盘。
- 生产如需真实 AI 图片生成，必须设置 `MINIMAX_API_KEY` 和可公网访问的 `PUBLIC_BASE_URL`。
- Docker 部署默认使用 `moyo_data` volume 挂载 `/data`。
- 公开访问应在反向代理层启用 HTTPS、访问日志和外部备份。
- 只有在可信反向代理会覆盖 `X-Forwarded-For` 时，才设置 `TRUST_PROXY=1`。
- 发布包不能携带本地 `data/` 文件，`npm run verify:clean-data`、`npm run audit:readiness` 和 `npm run verify:docker-context` 会检查这一点。

## 完成标准

- `npm run release:check` 通过。
- Docker daemon 可用时 `npm run release:full` 通过。
- `npm run verify:docker-build` 和 `npm run verify:docker-runtime` 在 Docker daemon 可用的 CI/部署环境通过。
- 本地或工作区 `data/` 没有账号、存档、上传图片等残留文件。
- 生产环境变量和持久化挂载按 README 配置完成。
