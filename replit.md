# Chewatabingo - Bingo Game

## Overview
A real-time multiplayer Bingo game built with Node.js, Express, and WebSockets. Players can select bingo cards, participate in live games, and compete to win. The application includes Telegram Web App integration for enhanced user experience.

## Project Architecture
- **Backend**: Node.js + Express server with WebSocket support for real-time communication
- **Frontend**: Vanilla JavaScript with HTML/CSS
- **Real-time**: WebSocket-based game state synchronization
- **Port Configuration**: Frontend runs on port 5000 (0.0.0.0)

## Tech Stack
- Node.js with Express v5.2.1
- WebSocket (ws) v8.18.3
- Vanilla JavaScript (no frameworks)
- Telegram Web App API integration

## File Structure
- `server.js` - Express server with WebSocket game logic
- `Index.html` - Main HTML file
- `game.js` - Client-side game logic and UI handlers
- `card.js` - Bingo card data (99 pre-generated cards)
- `style.css` - Styling

## Game Flow
1. **Landing Screen**: Players select stake amount and start game
2. **Selection Phase**: Players choose from 99 available bingo cards (45s timer)
3. **Game Phase**: Numbers are called every 3 seconds, players mark their cards
4. **Winner Phase**: First player to complete a valid bingo pattern wins (5s display)
5. Loop back to selection phase

## Recent Changes
- Fixed HTML reference from `cards.js` to `card.js`
- Added .gitignore for Node.js project
- Configured for Replit environment (port 5000, cache control enabled)

## Development Setup
The server is pre-configured to:
- Listen on 0.0.0.0:5000
- Serve static files from root directory
- Disable caching with Cache-Control headers
- Handle WebSocket connections for real-time gameplay
