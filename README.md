# Q3 Lite (mini Quake 3-style arena)

A minimal multiplayer browser FPS built with Three.js and Socket.IO. Runs anywhere Node.js runs, including GitHub Codespaces.

## Local quick start

- Requirements: Node.js 18+

```
# In one go
cd client && npm i && npm run build && cd ../server && npm i && npm start
```

Open `http://localhost:3000` in two browser windows to test.

## Codespaces

- Create a new GitHub repo and push this project
- Open in Codespaces
- Run:
```
cd client && npm i && npm run build && cd ../server && npm i && npm start
```
- Forward port 3000 (Codespaces will prompt). Share the forwarded URL with your friend

## Controls

- Click to lock cursor
- WASD + mouse to move
- Left mouse button to shoot

## Notes

This is a learning-friendly, simplified arena shooter:
- Client-side movement, server sync at 20 Hz
- Server handles hit detection (simple capsule hits), damage and respawn
- No persistence, no map collisions besides a flat floor
- Use it as a base to iterate (weapons, jump pads, items, proper map, latency compensation, etc.) 