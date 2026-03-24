import { createApp } from 'vue'
import App from './App.vue'
import { ensureLogin } from './utils/auth'

if (!window.CP2) {
  console.warn('当前不在 App 环境，使用 mock 数据')

  window.CP2 = {
    getUserInfo() {
      return Promise.resolve({
        code: "1",
        data: {
          login: "1",
          accountId: "test123",
          mobile: "13800000000",
          sessionId: "test-session",
          signature: "test-sign",
          timestamp: Date.now().toString(),
          user: {
            realName: "测试用户",
            image_url: "https://via.placeholder.com/100",
            nick_name: "测试昵称"
          }
        }
      })
    },
    showLogin() {
      console.log('模拟登录')
      return Promise.resolve()
    }
  }
}

async function bootstrap() {
  try {
    // 确保登录
    const user = await ensureLogin()

    window.__USER__ = user

    localStorage.setItem('user', JSON.stringify(user))

    console.log('用户信息：', user)

  } catch (e) {
    console.error('登录流程异常：', e)
  }

  createApp(App).mount('#app')
}

bootstrap()