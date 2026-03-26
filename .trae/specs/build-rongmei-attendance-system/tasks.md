# Tasks
- [x] Task 1: 梳理需求与领域模型，形成统一业务字典与判定口径。
  - [x] SubTask 1.1: 固化组织、角色、班次、围栏、异常状态与请假数据模型
  - [x] SubTask 1.2: 输出 8 类角色完整时段规则与跨天、季节规则映射

- [x] Task 2: 统一后端架构与 API 契约，完成数据库结构重建与迁移方案。
  - [x] SubTask 2.1: 设计并实现权限、用户、班次、打卡、请假、围栏、统计相关表结构
  - [x] SubTask 2.2: 重构接口为统一版本化路由并补齐错误码与鉴权中间件
  - [x] SubTask 2.3: 实现初始化数据、演示数据与必要迁移脚本

- [x] Task 3: 实现规则引擎与异常判定核心逻辑。
  - [x] SubTask 3.1: 实现角色时段匹配、迟到分钟计算、缺卡判定
  - [x] SubTask 3.2: 实现跨天归属、秋冬季自动切换、重复打卡过滤
  - [x] SubTask 3.3: 实现位置偏移计算与边缘预警标识

- [x] Task 4: 实现地理围栏与离线补传能力。
  - [x] SubTask 4.1: 前端实现离线缓存队列、重试补传与状态标记
  - [x] SubTask 4.2: 后端实现补传接收、幂等处理与离线上传审计字段

- [x] Task 5: 完成后台管理端（admin）可用化改造。
  - [x] SubTask 5.1: 实现权限登录、人员/角色/围栏/班次配置管理
  - [x] SubTask 5.2: 实现全台、部门、人员汇总看板与筛选查询
  - [x] SubTask 5.3: 实现周/月/自定义导出与异常高亮样式

- [x] Task 6: 完成移动端（h5）打卡流程增强。
  - [x] SubTask 6.1: 实现按角色展示当日应打卡节点与实时判定反馈
  - [x] SubTask 6.2: 实现围栏校验提示、离线上传提示与历史记录查询

- [x] Task 7: 接入请假/公出关联与统计口径。
  - [x] SubTask 7.1: 实现审批数据接入接口或适配层
  - [x] SubTask 7.2: 将请假数据并入缺卡判定与汇总指标

- [x] Task 8: 建立测试体系并完成发布门禁验证。
  - [x] SubTask 8.1: 编写规则引擎单元测试（角色、季节、跨天、重复打卡）
  - [x] SubTask 8.2: 编写 API 集成测试（鉴权、打卡、统计、导出）
  - [x] SubTask 8.3: 编写关键流程端到端测试（打卡、看板、导出、离线补传）
  - [x] SubTask 8.4: 执行回归测试并输出上线准入结论

- [x] Task 9: 完成部署与直接可用交付。
  - [x] SubTask 9.1: 优化 docker-compose 与环境变量模板
  - [x] SubTask 9.2: 提供初始化脚本、一键启动说明与回滚方案
  - [x] SubTask 9.3: 进行最终冒烟并确认“安装后可直接用”

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 2
- Task 5 depends on Task 2, Task 3
- Task 6 depends on Task 3, Task 4
- Task 7 depends on Task 2, Task 3
- Task 8 depends on Task 3, Task 4, Task 5, Task 6, Task 7
- Task 9 depends on Task 8
