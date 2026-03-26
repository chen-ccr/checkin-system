1、进入项目目录
cd /Users/ccr/test/checkin-system-vue

2、初始化环境变量
bash scripts/init-env.sh

3、执行质量门禁（测试+构建）
bash scripts/quality-gate.sh

4、一键启动（含部署与冒烟）
bash scripts/one-click-start.sh

5、仅冒烟验证
bash scripts/smoke-test.sh

6、故障回滚
bash scripts/rollback.sh

7、h5构建
docker compose up --build h5