let cp2Ready = false

export function getLocation() {
  return new Promise((resolve, reject) => {
    console.log('getLocation called')
    console.log('window.CP2:', window.CP2)
    console.log('window.CP2.getLocation:', window.CP2?.getLocation)

    if (!window.CP2) {
      console.error('window.CP2 not found')
      // 等待SDK初始化
      const checkCP2 = setInterval(() => {
        console.log('Waiting for CP2 to initialize...')
        if (window.CP2 && window.CP2.getLocation) {
          clearInterval(checkCP2)
          doGetLocation(resolve, reject)
        }
      }, 100)

      // 5秒超时
      setTimeout(() => {
        clearInterval(checkCP2)
        if (!window.CP2 || !window.CP2.getLocation) {
          reject(new Error('App SDK初始化超时'))
        }
      }, 5000)
      return
    }

    doGetLocation(resolve, reject)
  })
}

function doGetLocation(resolve, reject) {
  if (typeof window.CP2.getLocation !== 'function') {
    console.error('window.CP2.getLocation is not a function:', typeof window.CP2.getLocation)
    reject(new Error('getLocation方法不存在'))
    return
  }

  console.log('Calling window.CP2.getLocation()')
  const result = window.CP2.getLocation()

  if (result && typeof result.then === 'function') {
    result
      .then(res => {
        console.log('CP2.getLocation success:', res)
        // 转换格式: { code: "1", data: { latitude, lontitude, ... } } -> { lat, lng }
        const data = res.data || res
        const location = {
          lat: data.latitude || data.lat,
          lng: data.lontitude || data.longitude || data.lng
        }
        console.log('Converted location:', location)
        resolve(location)
      })
      .catch(err => {
        console.error('CP2.getLocation error:', err)
        reject(err)
      })
  } else {
    console.log('CP2.getLocation returned:', result)
    const data = result.data || result
    const location = {
      lat: data.latitude || data.lat,
      lng: data.lontitude || data.longitude || data.lng
    }
    console.log('Converted location:', location)
    resolve(location)
  }
}
