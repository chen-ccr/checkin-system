export async function ensureLogin() {
  console.log('ensureLogin 被调用，window.CP2:', !!window.CP2)
  
  // 如果不在App环境（浏览器），使用mock数据
  if (!window.CP2) {
    console.log('使用浏览器mock数据')
    return {
      userId: 'test123',
      name: '测试用户',
      avatar: 'https://via.placeholder.com/100',
      nickName: '测试昵称',
      mobile: '13800000000',
      sessionId: 'test-session',
      signature: 'test-sign',
      timestamp: Date.now().toString()
    }
  }

  // 1️⃣ 先尝试获取用户信息
  let res = await window.CP2.getUserInfo()
  console.log('getUserInfo 返回:', res)

  // 2️⃣ 如果未登录
  if (res.code !== "1" || res.data?.login !== "1") {
    console.log('未登录，拉起登录')

    await window.CP2.showLogin()

    // 3️⃣ 登录后再拿一次
    res = await window.CP2.getUserInfo()

    if (res.code !== "1") {
      throw new Error('登录后仍获取用户失败')
    }
  }

  const data = res.data

  return {
    userId: data.accountId,
    name: data.user.realName,
    avatar: data.user.image_url,
    nickName: data.user.nick_name,
    mobile: data.mobile,
    sessionId: data.sessionId,
    signature: data.signature,
    timestamp: data.timestamp
  }
}
