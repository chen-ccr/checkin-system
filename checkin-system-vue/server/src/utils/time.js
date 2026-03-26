function toDate(input) {
  if (input instanceof Date) return input
  return new Date(input)
}

function pad2(value) {
  return `${value}`.padStart(2, '0')
}

function formatDate(date) {
  const d = toDate(date)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatTime(date) {
  const d = toDate(date)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function combineDateTime(dateText, timeText) {
  return new Date(`${dateText}T${timeText}`)
}

function resolveBusinessDate(dateInput) {
  const d = toDate(dateInput)
  const minutes = d.getHours() * 60 + d.getMinutes()
  if (minutes <= 30) {
    const prev = new Date(d)
    prev.setDate(prev.getDate() - 1)
    return formatDate(prev)
  }
  return formatDate(d)
}

function isWinterSeason(dateInput) {
  const d = toDate(dateInput)
  const month = d.getMonth() + 1
  if (month >= 10) return true
  if (month <= 3) return true
  return false
}

module.exports = {
  toDate,
  formatDate,
  formatTime,
  combineDateTime,
  resolveBusinessDate,
  isWinterSeason
}
