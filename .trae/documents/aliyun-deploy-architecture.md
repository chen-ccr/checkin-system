# 阿里云服务器部署架构检查计划

## 问题分析

### 当前配置问题

1. **docker-compose.yml**
   - MySQL 设置了 `platform: linux/arm64` - 这是给本地 Mac M1/M2 用的
   - Server 没有设置 platform
   - **阿里云服务器是 x86_64 架构，需要 `linux/amd64`**

2. **server/Dockerfile**
   - 使用 `docker.1ms.run/library/node:18-alpine` - 中国镜像加速
   - 这个镜像加速在 GitHub Actions 上可能不需要

3. **h5/Dockerfile 和 admin/Dockerfile**
   - 使用 `node:18` 和 `nginx:alpine` - 没有镜像加速
   - 可能在 GitHub Actions 上构建失败（网络问题）

4. **GitHub Actions (docker-build.yml)**
   - 已正确设置 `platforms: linux/amd64`
   - 但 h5/admin 的 Dockerfile 没有镜像加速

## 修复方案

### 1. 创建生产环境 docker-compose 文件
创建 `docker-compose.prod.yml` 用于阿里云部署：
- 移除 `platform: linux/arm64`（使用默认 amd64）
- 使用 GitHub Container Registry 镜像

### 2. 修复 h5/Dockerfile
添加镜像加速支持

### 3. 修复 admin/Dockerfile
添加镜像加速支持

### 4. server/Dockerfile
保持现状，GitHub Actions 会自动处理

### 5. GitHub Actions
确认配置正确

## 实施步骤

1. 创建 `docker-compose.prod.yml` 用于生产环境
2. 修改 `h5/Dockerfile` 添加镜像加速
3. 修改 `admin/Dockerfile` 添加镜像加速
4. 推送代码触发 GitHub Actions 构建
5. 在阿里云服务器拉取镜像并启动
