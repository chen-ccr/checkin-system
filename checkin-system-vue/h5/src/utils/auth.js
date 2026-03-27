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
  console.log('getUserInfo 返回:', JSON.stringify(res))

  // 2️⃣ 检查返回格式（兼容code为数字1或字符串"1"）
  const code = String(res?.code ?? '')
  if (code !== '1') {
    console.log('未登录或获取失败，拉起登录')
    await window.CP2.showLogin()
    res = await window.CP2.getUserInfo()
    console.log('登录后 getUserInfo 返回:', JSON.stringify(res))
    if (String(res?.code ?? '') !== '1') {
      throw new Error('登录后仍获取用户失败')
    }
  }

  // 3️⃣ 检查是否已登录（login字段可能不存在）
  if (res.data?.login && String(res.data.login) !== '1') {
    console.log('login状态不为1，拉起登录')
    await window.CP2.showLogin()
    res = await window.CP2.getUserInfo()
    console.log('登录后 getUserInfo 返回:', JSON.stringify(res))
    if (String(res?.code ?? '') !== '1') {
      throw new Error('登录后仍获取用户失败')
    }
  }

  const data = res.data
  console.log('用户数据:', data)

  return {
    userId: data.accountId,
    name: data.user?.realName || data.user?.realname,
    avatar: data.user?.image_url,
    nickName: data.user?.nick_name,
    mobile: data.mobile,
    sessionId: data.sessionId,
    signature: data.signature,
    timestamp: data.timestamp
  }
}
