# uniCloud部署计划

## uniCloud云数据库说明

**uniCloud云数据库是MongoDB**，不是MySQL。

**不能直接导入MySQL的.sql文件**，因为：
- MySQL使用SQL语句
- MongoDB使用JSON格式文档
- 表结构完全不同

## 数据迁移方案

### 方案1：使用CSV中转（推荐）
1. 从MySQL导出CSV
2. 写一个转换脚本把CSV转为MongoDB JSON格式
3. 通过uniCloud API或前端上传导入

### 方案2：写迁移脚本
1. 读取MySQL数据
2. 转换为MongoDB文档格式
3. 调用uniCloud云函数写入数据库

## uniCloud云数据库表结构

需要将MySQL表转为MongoDB集合：

### users（用户表）
```json
{
  "_id": "用户ID",
  "name": "姓名",
  "nickname": "昵称",
  "phone": "手机号",
  "department_id": 1,
  "role_id": 1,
  "is_active": true,
  "created_at": "2026-03-27T00:00:00.000Z"
}
```

### departments（部门表）
```json
{
  "_id": 1,
  "name": "部门名称"
}
```

### roles（角色表）
```json
{
  "_id": 1,
  "code": "ADMIN",
  "name": "管理员"
}
```

### geofences（围栏表）
```json
{
  "_id": 1,
  "name": "围栏名称",
  "lat": 28.68503,
  "lng": 115.89925,
  "radius": 200,
  "is_active": true
}
```

### role_shift_rules（班次规则表）
```json
{
  "_id": 1,
  "role_id": 1,
  "punch_index": 1,
  "start_time": "08:00:00",
  "end_time": "08:35:00",
  "winter_start_time": null,
  "required_fence_id": null
}
```

### checkin_records（打卡记录表）
```json
{
  "_id": ObjectId,
  "user_id": "用户ID",
  "punch_index": 1,
  "lat": 28.68503,
  "lng": 115.89925,
  "punched_at": "2026-03-27T08:00:00.000Z",
  "status": "NORMAL"
}
```

## 部署步骤

1. 在uniCloud控制台创建云数据库
2. 创建对应的集合（表）
3. 导出本地MySQL数据为CSV
4. 转换为MongoDB格式并导入
5. 修改后端代码适配uniCloud云函数
6. 部署H5和后台管理到静态托管

## 问题确认

**工作量评估：**
- 数据迁移：需要写转换脚本（约1-2小时）
- 代码改造：后端需要完全重写为云函数（约2-3天）

**您确定要用uniCloud吗？** 还是考虑用带Docker的Linux服务器更简单？
