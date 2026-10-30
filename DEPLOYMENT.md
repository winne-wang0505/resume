# 部署验收清单

- [ ] 仓库源码已推送到 GitHub。
- [ ] 仓库 Settings → Pages 已选择 GitHub Actions。
- [ ] Website checks and deployment 工作流成功，实际网站可访问。
- [ ] 手机与电脑页面布局和主屏幕安装已在目标设备验证。
- [ ] Brave Search API 凭据已安全配置，真实检索成功，逐一核验至少一个内地和一个香港链接。
- [ ] 每日任务所需岗位／城市变量已设置，定时或手动运行成功。
- [ ] 如需多用户服务，已完成认证、数据库、任务队列、订阅退订和隐私政策。

这些是尚待平台或外部服务验证的项目，不应因本地测试通过而自动勾选。

## 岗位质量升级验收

- Upgrade existing job details 会在详情代码推送后自动运行，无需重新输入密钥。
- 检查该任务 Summary 的具体岗位、待核实和过滤数量；来源访问失败不是搜索密钥错误。
- 日报主区只显示可评估职位，待核实区显示访问或信息缺失原因，来源证据在分析弹窗折叠区。
- 无可评估岗位时不以汇总页补足数量。已知截止、岗位方向不对应、不同币种等应有明确处理。
- GitHub Pages 没有即时搜索服务不影响已发布索引的读取；“加载最新日报”不会触发 Brave 搜索。

## 来源、分页与历史池验收

- 日报“招聘来源与覆盖范围”区分已配置入口与实际取得的岗位；注册表入口数不等于本轮启用来源或已成功采集的企业数。
- GitHub 任务 Summary 与日报显示当日请求用量、翻页次数、历史保留及企业数量。
- 默认24次/日，已保存的正常重跑复用计数；不设置新变量也能运行。提高预算前核对 Brave 账户额度。
- 已知岗位暂未出现在搜索中仍可保留，带历史标记和原读取时间；超过复核期限转为待核实。
- 已明确截止或不符合当前需求的历史岗位不会恢复到有效池；重复页不无限翻页。

## 浏览器渲染与来源健康

本次代码部署不需要新增密钥或购买服务。daily/enrich 工作流自动执行 `npm ci` 和 `npx playwright install --with-deps chromium`，通过 `JOB_BROWSER_RENDER: "true"` 开启最多 4 次/轮的公开页面渲染。现有 Brave secret 和岗位偏好变量继续生效；搜索次数默认仍为 24 次/天。

本地需要渲染时先运行 `npm ci`、`npx playwright install chromium`，再以 `JOB_BROWSER_RENDER=true npm run jobs:refresh` 启动；已有系统 Chromium 可用 `CHROMIUM_PATH=/usr/bin/chromium`。默认本地静态读取和页面查看不要求浏览器安装。授权接口尚未接入，遇到验证码、HTTP405或跨域依赖时可能仍需手动粘贴正文；不应通过反复重跑消耗搜索额度。

来源健康保存在 jobs.json 的 sourceHealth，连续三次访问限制/robots/网络失败后暂缓 48 小时，成功读取后恢复；未尝试的来源没有统计，不代表已接通。官网 JSON 适配受页面实际结构约束，不保证所有官网页面都会成功。

发布前检查见 [功能基线](docs/FEATURE_BASELINE.md)。GitHub Pages 构建会新增手机/电脑回归测试，覆盖档案、偏好、岗位分析、本机导入、收藏、投递状态和刷新保留。

## 多用户自主修改日报检索需求

新增个人后端服务；原 GitHub Actions 仍生成共享岗位池，不接收或公开个人会话数据。GitHub Pages 用户只有连接个人后端后才会获得真实自主搜索。

无服务器时，按照 [个人服务部署指南](docs/PERSONAL_SERVICE.md)使用仓库 Dockerfile / render.yaml 创建常驻服务及持久磁盘。该配置涉及收费资源，必须由仓库所有者在平台确认套餐并创建；代码推送不会自动购买。无需把后台 API key 交给 App 用户。部署后的 Render 服务同时提供完整前端和 API；共享原 Pages 地址时，可在 public/service.json 配置公开 apiBase。

## 精选来源与失效清理

`JOB_SOURCE_MODE` 默认 standard（猎聘／OfferToday）；preferred 为 BOSS／OfferToday，BOSS 未接入授权数据前不会自动读取。App 同样可自行选择来源。无需新密钥，来源受限时不会扩大到全部平台。

本轮先以 `node scripts/clean-index.mjs` 对旧公开索引做元数据清理，不发起搜索，也不修改原读取时间。新版本启动后，个人 API 读取及浏览器加载也会剔除已知失效记录。常驻 Render 服务会在 GitHub 更新后按现有部署设置发布新代码；每日额度保持原值。
