import { createClient } from 'redis'
import { REDIS_URL, ROOM_TTL_SECONDS } from './config.js'

class InMemoryStore {
  constructor() {
    this.rooms = new Map()
  }

  async getRoom(code) {
    return this.rooms.get(code) || null
  }

  async saveRoom(code, room) {
    this.rooms.set(code, room)
  }

  async deleteRoom(code) {
    this.rooms.delete(code)
  }

  async close() {}
}

class RedisRoomStore {
  constructor(client) {
    this.client = client
  }

  key(code) {
    return `room:${code}`
  }

  async getRoom(code) {
    const raw = await this.client.get(this.key(code))
    return raw ? JSON.parse(raw) : null
  }

  async saveRoom(code, room) {
    await this.client.set(this.key(code), JSON.stringify(room), {
      EX: ROOM_TTL_SECONDS,
    })
  }

  async deleteRoom(code) {
    await this.client.del(this.key(code))
  }

  async close() {
    await this.client.quit()
  }
}

export async function createRoomStore() {
  if (!REDIS_URL) return new InMemoryStore()

  const client = createClient({ url: REDIS_URL })
  client.on('error', error => {
    console.error('Redis error:', error)
  })
  await client.connect()
  return new RedisRoomStore(client)
}
