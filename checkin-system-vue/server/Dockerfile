FROM node:18

WORKDIR /app

# 1. 拷贝 package.json
COPY package*.json ./

# 2. 强制清理并安装 (增加 --loglevel info 方便我们在日志看安装过程)
RUN rm -rf node_modules && npm install --loglevel info

# 3. 拷贝源代码
COPY . .

# 4. 运行时验证（这一步如果报错，构建就会停止，帮我们提前发现问题）
RUN node -e "require('mysql2')" && echo "Success: mysql2 is found"

EXPOSE 3001
CMD ["node", "app.js"]