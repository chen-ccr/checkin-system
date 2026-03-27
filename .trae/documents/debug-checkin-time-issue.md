# 排查计划：有效时间内打卡报错"当前时间不在任何有效打卡时段"

## 问题描述
- 用户在有效打卡时段内（第4节点 16:30:00-22:00:00）
- 在围栏范围内
- precheck 接口返回成功
- 但 submitCheckin 打卡接口报错"当前时间不在任何有效打卡时段"

## 问题分析

### 关键代码路径
1. `precheckLocation` (attendanceService.js:806-836)
   - 获取用户 → 获取班次规则 → `resolveCurrentPunchIndex(rules, now)` → 返回结果

2. `submitCheckin` (attendanceService.js:16-76)
   - 获取用户 → 获取班次规则 → `resolveCurrentPunchIndex(shiftRules, punchAt)` → 抛出错误

3. `resolveCurrentPunchIndex` (ruleEngine.js:11-23)
   - 将时间转换为分钟数
   - 遍历规则查找匹配时段
   - 未匹配则抛出错误

### 可能原因
1. **用户 role_id 问题**：用户可能没有正确的 role_id，导致获取不到班次规则
2. **时间格式问题**：`formatTime` 函数可能有时区问题
3. **规则数据问题**：数据库中的 start_time/end_time 格式可能有问题
4. **precheck 和 submitCheckin 使用了不同的时间源**

## 排查步骤

### 步骤1：添加调试日志
在 `resolveCurrentPunchIndex` 函数中添加详细日志：
- 当前时间（原始和转换后）
- 所有规则的时段
- 匹配结果

### 步骤2：检查用户数据
- 确认用户的 role_id 是否正确
- 确认该 role_id 是否有班次规则

### 步骤3：检查时间计算
- 验证 `formatTime` 返回的时间格式
- 验证 `toMinutes` 的计算结果

### 步骤4：修复问题
根据排查结果修复代码

## 实施计划

1. 在 `ruleEngine.js` 添加调试日志
2. 重启本地 Docker 服务
3. 执行打卡测试，查看日志
4. 根据日志定位具体问题
5. 修复代码并验证
