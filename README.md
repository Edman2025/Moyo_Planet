# 萌友星球 Moyo Planet

开源的移动端 H5 社交养成小游戏。当前版本是本地前后端可运行产品，支持玩家注册/登录、服务端存档、上传照片生成宠物、照顾、学习升年级、技能养成、工作赚钱、商店消费、城市聊天、通过真实玩家邀请码添加好友、好友农场、抢车位和任务领奖。

当前 Node API 会把账号、PBKDF2 密码哈希、游戏存档、公共城市聊天、共享车位状态和上传图片写入 `DATA_DIR` 指定目录；浏览器只保存登录 token。金币、钻石、学历、技能、任务、工作、停车和社交收益都由 `/api/action` 服务端结算，`/api/state` 只接受宠物名字和风格这类客户端可编辑外观字段，不能改写经济或成长进度。服务端要求写入类 API 使用 `application/json` 且请求体必须是 JSON 对象，非法 JSON、非对象 JSON 和非对象动作参数会返回明确的 400/415 错误；公开健康检查不暴露用户数量。服务端写入存档时会清洗字段、限制数值范围和数组长度、拒绝外部上传 URL，并压平昵称、宠物名、上传文件名和聊天内容中的控制字符；公开昵称、宠物名和城市聊天会拒绝链接或联系方式，避免真实用户公共界面被引流信息污染。接口默认按直连 socket 地址限流，不信任客户端传入的 `X-Forwarded-For`；如果部署在会覆盖转发头的可信反向代理后面，可设置 `TRUST_PROXY=1`，并可用 `RATE_LIMIT_MAX` 和 `RATE_LIMIT_WINDOW_MS` 调整窗口。服务端会清理过期或指向不存在用户的 session，并清理无效或与用户状态不一致的共享车位，避免异常恢复后出现幽灵登录或幽灵占位。存档使用临时文件原子替换，并保留上一份 `moyo-db.backup.json` 用于启动恢复。静态资源托管会限制路径必须位于 `dist/` 内，上传访问只使用服务端生成的随机文件名，不暴露内部用户 ID；用户替换上传或重置进度时会清理旧上传文件。所有响应带基础安全头、CSP 和权限策略。面向公网真实用户时，应把 `DATA_DIR` 挂到持久化磁盘，并在反向代理层启用 HTTPS、外部备份和访问日志。

## 启动

```bash
npm install
npm run dev
```

默认本地地址：

```text
前端：http://127.0.0.1:5173/
API：http://127.0.0.1:4173/
```

## 生产启动

```bash
npm run build
NODE_ENV=production HOST=0.0.0.0 PORT=4173 DATA_DIR=/var/lib/moyo-planet npm run start
```

`npm run start` 会先检查 `dist/` 是否存在、`DATA_DIR` 是否配置且可写，再启动 API 并托管静态文件。生产探活可使用 `GET /api/health` 或 `HEAD /api/health`。
启动检查和服务端直接启动都会校验 `PORT`、`SESSION_TTL_DAYS`、`RATE_LIMIT_MAX`、`RATE_LIMIT_WINDOW_MS` 和 `TRUST_PROXY`，配置不合法会直接失败。

常用生产环境变量：

```text
DATA_DIR=/var/lib/moyo-planet
SESSION_TTL_DAYS=30
RATE_LIMIT_MAX=180
RATE_LIMIT_WINDOW_MS=60000
TRUST_PROXY=0
PUBLIC_BASE_URL=https://your-domain.example
MINIMAX_API_URL=https://api.minimaxi.com/v1/image_generation
MINIMAX_API_KEY=
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=http://127.0.0.1:4173
```

只有在部署在会覆盖 `X-Forwarded-For` 的可信反向代理之后，才把 `TRUST_PROXY` 设为 `1`。
配置 `MINIMAX_API_KEY` 和可公网访问的 `PUBLIC_BASE_URL` 后，上传照片生成宠物会调用 MiniMax `image-01` 生成真实图片；未配置时会使用本地 SVG 规则生成作为开发 fallback。

本地页面如果要复用线上 MiniMax 生成链路，可以用公网 API 启动前端：

```bash
VITE_API_BASE_URL=https://your-api.example npm run dev:client
```

这会让 `http://127.0.0.1:5173` 直接请求公网 API，并显示公网生成的 `/uploads` 与 `/generated-pets` 图片。

Docker 启动：

```bash
docker compose up --build
```

默认容器端口为 `4173`，用户数据保存在 `moyo_data` volume。镜像构建会通过 `.dockerignore` 排除本地 `data/`、`node_modules/`、`dist/` 和 Git 元数据，避免把开发机数据或依赖缓存打进镜像。

## 已实现

- 宠物主页：金币、钻石、等级、经验、状态条、照顾动作。
- 玩家账号：注册、登录、PBKDF2-SHA256 密码哈希、旧哈希登录迁移、玩家邀请码、登录 token。
- 服务端存档：游戏进度保存在 `DATA_DIR`；`/api/state` 只同步宠物名字和风格，服务端会拒绝客户端改写金币、学历、任务等权威字段。
- 服务端结算：照顾、宠物生成、购买、使用道具、学习、工作开始/完成、添加好友、好友农场收益、赠礼、聊天、城市访问、共享停车和任务领奖通过 `/api/action` 由服务端计算并保存。
- 误触保护：重新开始会先弹出确认，确认后才重置金币、学历、任务、工作、停车和上传照片，玩家账号保留。
- 宠物生成：上传入口、上传成功提示、服务端图片存储、照片预览、风格选择、生成中状态、钻石消耗；生产配置 MiniMax 后会调用真实图片模型生成宠物图。
- 学习养成：年级、学历、学分、编程/商业/沟通技能成长。
- 工作系统：工作列表、属性/学历/技能要求、精力消耗、倒计时、金币和经验结算，高薪工作随学历和技能解锁。
- 商店背包：购买道具、扣除资源、持有数量、使用后恢复状态或提升属性。
- 城市社交：地图探索、服务端公共城市聊天、进入地点完成城市任务。
- 社交玩法：通过真实玩家邀请码添加好友、好友拜访、赠礼、基于真实好友账号生成的农场收益、服务端共享抢车位。
- 任务系统：任务完成判断、领取奖励、防重复领取。
- 后端数据：账号、存档和上传文件写入 `DATA_DIR`，存档原子写入并保留上一份备份；本地默认 `data/` 不会提交到 Git。

## 检查

```bash
npm run lint
npm run build
npm run verify
npm run verify:journey
npm run verify:ui
npm run verify:install
npm run verify:secrets
npm run verify:dependencies
npm run verify:clean-data
npm run verify:docker-context
npm run verify:docker-build
npm run verify:docker-runtime
npm run audit:readiness
npm run release:check
npm run release:full
```

`docs/release-requirements.json` 记录上线验收要求和对应证据命令，`npm run audit:readiness` 会校验这份清单没有缺失核心要求。
`npm run verify` 会使用临时数据目录启动 API，真实跑通双用户注册、登录、新用户无预置好友/聊天/占用车位、复制邀请码大小写/空白容错、PBKDF2 密码存储、旧哈希迁移、注册文本清洗、公开昵称和宠物名联系方式拦截、真实邀请码加好友、跨用户公共聊天、聊天链接和联系方式拦截、共享车位互斥占用、过期 session 和孤儿车位清理、服务端权威结算、客户端篡改存档拒绝、图片上传、上传文件名清洗、随机上传 URL、旧上传清理、非法图片和超大图片拒绝、非法 JSON、非对象请求体和错误 Content-Type 拒绝、关键 API 错误方法 405、安全响应头、静态路径穿越拒绝、未授权拒绝、默认不信任伪造 `X-Forwarded-For` 的限流检查、生产启动检查和损坏主库后的备份恢复；运行结束会删除临时数据。
`npm run verify:journey` 会使用临时数据目录启动 API，按第一天玩家旅程跑通注册、宠物生成、照片上传、照顾、商店购买/使用、学习升级、解锁工作、工作结算、城市聊天、真实好友邀请码、好友农场、赠礼、共享停车、任务领奖和重置清理。
`npm run verify:ui` 会使用临时数据目录启动生产包，并用本机 Chrome 跑移动端真实界面交互：注册、上传图片成功反馈、用照片生成宠物、商店购买/使用、城市聊天和地点访问、真实邀请码加好友、好友农场、赠礼、停车、工作页学历/技能展示、学习升年级、岗位解锁、任务领奖、退出登录、用邀请码重新登录恢复进度、取消重置和确认重置回到干净初始状态。默认使用 `PLAYWRIGHT_CHANNEL=chrome`；如果本机浏览器位置不同，可设置 `PLAYWRIGHT_CHANNEL` 或 `PLAYWRIGHT_EXECUTABLE_PATH`。
`npm run verify:install` 会执行 `npm ci --dry-run --ignore-scripts`，确认 `package-lock.json` 与 `package.json` 同步且可干净安装。
`npm run verify:secrets` 会扫描仓库文本文件中的高置信度明文密钥形态，例如 private key、OpenAI/GitHub/AWS/Stripe/Slack token，并跳过 `node_modules/`、`dist/`、`data/` 等生成目录。
`npm run verify:dependencies` 会执行 `npm audit --omit=dev --audit-level=high`，确认生产依赖没有高危或严重漏洞。
`npm run verify:clean-data` 会检查本地 `data/` 没有任何账号、存档、聊天、停车或上传图片残留，并确认 `.gitignore` 和 `.dockerignore` 都排除了 `data/`。
`npm run verify:docker-context` 会用 `.dockerignore` 生成一次临时 Docker 构建上下文，确认 `data/`、`dist/`、`node_modules/`、Git 元数据、`.env` 和 `progress.md` 不会被打入镜像，同时确认构建所需源码和生产检查脚本仍在上下文中。
`npm run verify:docker-build` 会先验证 `docker compose config`，再执行真实 `docker build`；它需要本机或 CI 环境已经启动 Docker daemon，适合在部署机/CI 上补充证明镜像可以实际构建。
`npm run verify:docker-runtime` 会真实构建镜像、启动容器、挂载临时 `/data`、访问容器内生产首页、注册玩家、恢复 session，并检查宿主临时数据目录生成了 `moyo-db.json` 且密码使用 PBKDF2 存储。
`npm run audit:readiness` 会检查关键源码、脚本、Docker/Compose、忽略规则、README 功能承诺、前端占位/假数据文案、默认数据库/初始社交状态为空和本地 `data/` 残留。
`npm run release:check` 会串行执行 readiness audit、verify:clean-data、verify:install、verify:secrets、verify:dependencies、lint、build、verify、verify:journey、verify:ui、verify:docker-context，并用临时 `DATA_DIR` 启动生产服务，检查 `GET/HEAD /api/health`、首页生产包可访问性、生产模式真实注册、会话恢复和 `moyo-db.json` 持久化；末尾会再次执行 clean-data 和 readiness，适合作为上线前本机闸门。
`npm run release:full` 会在 Docker daemon 可用时串行执行 `release:check`、Docker 镜像构建验证、Docker 容器运行验证和最终 clean-data，是上线前最完整的一键闸门。
`.github/workflows/release-check.yml` 会在 GitHub Actions 中运行 `npm run release:check`、`npm run verify:docker-build` 和 `npm run verify:docker-runtime`，用于在有 Docker daemon 的 CI 环境补充验证真实镜像构建和容器运行。

## 参与贡献

欢迎通过 Issue 报告问题或提出建议。提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露漏洞细节。

## 开源许可

项目源代码采用 [MIT License](LICENSE) 开源。上传照片、模型生成内容和部署时接入的第三方服务仍受其各自条款约束。
