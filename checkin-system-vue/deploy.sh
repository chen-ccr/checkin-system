#!/bin/bash
set -e

echo "=== 考勤系统部署脚本 ==="

echo "1. 检查 Docker..."
if ! command -v docker &> /dev/null; then
    echo "安装 Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

if ! command -v docker-compose &> /dev/null; then
    echo "安装 docker-compose..."
    curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

echo "2. 配置 Docker 镜像加速..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF
systemctl restart docker

echo "3. 部署服务..."
cd "$(dirname "$0")"
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

echo "4. 检查服务状态..."
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "=== 部署完成 ==="
echo "后台管理: http://服务器IP:8090"
echo "H5打卡: http://服务器IP:8091"
echo "API服务: http://服务器IP:3001"
