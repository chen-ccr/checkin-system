import { createApp } from 'vue'
import App from './App.vue'
import { ensureLogin } from './utils/auth'

// 用userAgent判断是否在App内
const inApp = /xsb/gi.test(navigator.userAgent)

if (!inApp) {
  console.warn('非App环境，使用mock数据')
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
    },
    getLocation() {
      console.log('Mock getLocation 被调用')
      return Promise.resolve({
        code: "1",
        data: {
          latitude: 28.68503,
          lontitude: 115.89925,
          address: '江西省南昌市东湖区'
        }
      })
    }
  }
} else {
  console.log('App环境，使用原生CP2')
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
