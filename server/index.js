import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { SERVER_PORT } from './config.js'
import { createRoomStore } from './store.js'
import { registerSocketHandlers } from './socketServer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '../dist')

const app = express()
app.use(express.json())

app.get('/health', (_request, response) => {
  response.json({ ok: true })
})

app.use(express.static(distDir))
app.get('*', (_request, response) => {
  response.sendFile(path.join(distDir, 'index.html'))
})

const httpServer = http.createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
})

const store = await createRoomStore()
registerSocketHandlers(io, store)

httpServer.listen(SERVER_PORT, () => {
  console.log(`Socket server listening on http://localhost:${SERVER_PORT}`)
})

const shutdown = async () => {
  io.close()
  httpServer.close(async () => {
    await store.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
