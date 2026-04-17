# Express + Socket.IO + Redis Backend

The repo now includes a Node backend in `server/` that can run beside the existing Vite frontend.

## What it does

- `Express` serves a health route.
- `Socket.IO` handles realtime game events.
- `Redis` stores room state when `REDIS_URL` is configured.
- If `REDIS_URL` is not set, the server falls back to in-memory state for local development.

## Events

- `host:create_room`
- `host:attach`
- `host:start_round`
- `host:reveal_round`
- `host:advance_round`
- `host:distribute_powerups`
- `player:join_room`
- `player:submit_answer`
- `player:use_powerup`

## Environment

- `PORT`
- `CLIENT_ORIGIN`
- `REDIS_URL`
- `ROOM_TTL_SECONDS`
- `VITE_SOCKET_SERVER_URL`

## Migration status

The new backend is scaffolded and the client transport exists in `src/socketApi.ts`.
The React UI still contains the Firebase path, so the next migration step is to replace the Firebase calls in `HostApp.tsx` and `PlayerApp.tsx` with the socket transport.
