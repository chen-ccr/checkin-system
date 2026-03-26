# 融媒体中心考勤系统交付说明

## 1. 环境准备

```bash
cd /Users/ccr/test/checkin-system-vue
bash scripts/init-env.sh
```

如需自定义端口、数据库或密钥，修改 `.env`。

## 2. 测试门禁

发布前执行统一门禁：

```bash
bash scripts/quality-gate.sh
```

门禁内容：
- `server` 单元测试与 API 集成测试
- `h5` 构建验证
- `admin` 构建验证

## 3. 一键启动与部署

```bash
bash scripts/one-click-start.sh
```

该命令会自动完成：
- 生成 `.env`
- 执行质量门禁
- `docker compose up -d --build`
- 自动执行冒烟验证

若只执行部署：

```bash
bash scripts/deploy.sh
```

## 4. 冒烟验证

```bash
bash scripts/smoke-test.sh
```

脚本支持三种模式：
- `auto`：默认模式，检测到 Docker 可用则走部署服务冒烟，否则自动切换本地免 Docker 冒烟
- `docker`：仅验证已部署容器服务（`bash scripts/smoke-test.sh .env docker`）
- `local`：免 Docker 冒烟，使用内存态 API + 本地前端构建产物（`bash scripts/smoke-test.sh .env local`）

验证项包括：
- `h5` 页面可访问
- `admin` 页面可访问
- 登录鉴权可用
- 打卡计划接口可用
- 受保护统计接口可用
- 围栏预检接口可用
- `xlsx` 双报表导出可用

每次执行都会输出可审计证据文件，默认路径为 `smoke-evidence/smoke-时间戳.json`。
可通过 `SMOKE_EVIDENCE_FILE` 或 `SMOKE_EVIDENCE_DIR` 覆盖输出位置。

## 5. 回滚方案

每次部署前会自动把 `latest` 镜像标记为 `rollback`。

出现故障时执行：

```bash
bash scripts/rollback.sh
```

回滚后将使用 `checkin-server:rollback`、`checkin-h5:rollback`、`checkin-admin:rollback` 启动服务。
