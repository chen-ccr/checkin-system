import { createApp } from 'vue'
import App from './App.vue'
import { ensureLogin } from './utils/auth'

// 强制使用 mock 数据，忽略外部的 window.CP2
console.warn('强制使用 mock 数据进行测试')

window.CP2 = {
  getUserInfo() {
    console.log('Mock getUserInfo 被调用')
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
    console.log('Mock showLogin 被调用')
    return Promise.resolve()
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
