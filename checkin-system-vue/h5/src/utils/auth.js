export async function ensureLogin() {
  if (!window.CP2) {
    throw new Error('请在 App 内打开')
  }

  // 1️⃣ 先尝试获取用户信息
  let res = await window.CP2.getUserInfo()

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