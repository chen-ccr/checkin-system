export function getLocation() {
  return new Promise((resolve, reject) => {
    if (window.CP2?.getLocation) {
      window.CP2.getLocation().then(resolve).catch(reject)
    } else {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        }),
        reject
      )
    }
  })
}