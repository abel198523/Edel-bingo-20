# Chewatabingo - Bingo Game

## Overview
A real-time multiplayer Bingo game built with Node.js, Express, and WebSockets. Players can select bingo cards, participate in live games, and compete to win. The application includes Telegram Web App integration for enhanced user experience.

## Project Architecture
- **Backend**: Node.js + Express server with WebSocket support for real-time communication
- **Frontend**: Vanilla JavaScript with HTML/CSS (in `public/` folder)
- **Real-time**: WebSocket-based game state synchronization
- **Deployment**: Configured for Render.com deployment

## Tech Stack
- Node.js with Express v5.2.1
- WebSocket (ws) v8.18.3
- Vanilla JavaScript (no frameworks)
- Telegram Web App API integration

## File Structure
```
├── server.js           # Express server with WebSocket game logic
├── package.json        # Dependencies and scripts
├── render.yaml         # Render deployment configuration
└── public/
    ├── index.html      # Main HTML file
    ├── game.js         # Client-side game logic and UI handlers
    ├── card.js         # Bingo card data (99 pre-generated cards)
    └── style.css       # Styling
```

## Game Flow
1. **Landing Screen**: Players select stake amount and start game
2. **Selection Phase**: Players choose from 99 available bingo cards (45s timer)
3. **Game Phase**: Numbers are called every 3 seconds, players mark their cards
4. **Winner Phase**: First player to complete a valid bingo pattern wins (5s display)
5. Loop back to selection phase

## Render Deployment
1. Connect your GitHub repository to Render
2. Select "Web Service"
3. Render will auto-detect settings from `render.yaml`
4. Deploy!

Or manually configure:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**: Node

## Environment Variables
- `PORT` - Set automatically by Render (default: 10000 for local development)
- `NODE_ENV` - Set to "production" on Render

## Recent Changes
- Configured project for Render.com deployment
- Moved static files to `public/` folder
- Added `render.yaml` for easy deployment
- Updated PORT to use environment variable
