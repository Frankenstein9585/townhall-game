export const SERVER_PORT = Number(process.env.PORT || 5000)
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'
export const REDIS_URL = process.env.REDIS_URL || ''
export const ROOM_TTL_SECONDS = Number(process.env.ROOM_TTL_SECONDS || 60 * 60 * 6)
