# Authoritative Backend Plan

This repo now includes a `functions/` workspace intended to become the trusted game backend.

## Responsibilities moved off the client

- Room creation with collision checks
- Player join using stable `playerId` instead of display name as the database key
- Answer submission validation against the active round
- Round reveal and score resolution
- Power-up consumption during scoring

## Recommended room shape

```text
rooms/{code}
  state
  host
    puzzles
  public
    currentPuzzle
    deltas
    powerupEvents
  players/{playerId}
  answers/{roundIndex}/{playerId}
  powerUpsUsed/{roundIndex}/{playerId}
```

## Frontend migration path

1. Replace direct writes to room state with callable function requests.
2. Subscribe player clients to `public/*` plus their own player record.
3. Keep host subscribed to both `host/*` and `public/*`.
4. Remove puzzle answers from all player-visible data.
