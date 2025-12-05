require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const jwt = require('jsonwebtoken');

const db = require('./db/database');
const User = require('./models/User');
const Wallet = require('./models/Wallet');
const Game = require('./models/Game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'chewatabingo-secret-key-change-in-production';
const SELECTION_TIME = 45;
const WINNER_DISPLAY_TIME = 5;

let currentGameId = null;
let gameState = {
    phase: 'selection',
    timeLeft: SELECTION_TIME,
    calledNumbers: [],
    masterNumbers: [],
    winner: null,
    players: new Map(),
    stakeAmount: 10
};

let playerIdCounter = 0;

function initializeMasterNumbers() {
    gameState.masterNumbers = [];
    for (let i = 1; i <= 75; i++) {
        gameState.masterNumbers.push(i);
    }
    gameState.calledNumbers = [];
}

function getLetterForNumber(num) {
    if (num >= 1 && num <= 15) return 'B';
    if (num >= 16 && num <= 30) return 'I';
    if (num >= 31 && num <= 45) return 'N';
    if (num >= 46 && num <= 60) return 'G';
    if (num >= 61 && num <= 75) return 'O';
    return '';
}

function callNumber() {
    const uncalledNumbers = gameState.masterNumbers.filter(
        num => !gameState.calledNumbers.includes(num)
    );
    
    if (uncalledNumbers.length === 0) {
        return null;
    }
    
    const randomIndex = Math.floor(Math.random() * uncalledNumbers.length);
    const calledNumber = uncalledNumbers[randomIndex];
    gameState.calledNumbers.push(calledNumber);
    
    return {
        number: calledNumber,
        letter: getLetterForNumber(calledNumber)
    };
}

function broadcast(message) {
    const data = JSON.stringify(message);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

function getConfirmedPlayersCount() {
    let count = 0;
    gameState.players.forEach((player) => {
        if (player.isCardConfirmed) {
            count++;
        }
    });
    return count;
}

async function startSelectionPhase() {
    gameState.phase = 'selection';
    gameState.timeLeft = SELECTION_TIME;
    gameState.winner = null;
    gameState.calledNumbers = [];
    
    gameState.players.forEach((player, id) => {
        player.selectedCardId = null;
        player.isCardConfirmed = false;
    });
    
    try {
        const game = await Game.create(gameState.stakeAmount);
        currentGameId = game.id;
        console.log(`New game created: #${currentGameId}`);
    } catch (err) {
        console.error('Error creating game:', err);
    }
    
    broadcast({
        type: 'phase_change',
        phase: 'selection',
        timeLeft: gameState.timeLeft,
        gameId: currentGameId
    });
}

function startGamePhase() {
    gameState.phase = 'game';
    gameState.timeLeft = -1;
    initializeMasterNumbers();
    
    broadcast({
        type: 'phase_change',
        phase: 'game',
        timeLeft: -1,
        players: getPlayersInfo()
    });
}

async function startWinnerDisplay(winnerInfo) {
    stopNumberCalling();
    gameState.phase = 'winner';
    gameState.timeLeft = WINNER_DISPLAY_TIME;
    gameState.winner = winnerInfo;
    
    try {
        if (currentGameId && winnerInfo.userId) {
            const game = await Game.setWinner(
                currentGameId, 
                winnerInfo.userId, 
                winnerInfo.cardId,
                gameState.calledNumbers
            );
            
            if (game && game.total_pot > 0) {
                await Wallet.win(winnerInfo.userId, game.total_pot, currentGameId);
                winnerInfo.prize = game.total_pot;
            }
        }
    } catch (err) {
        console.error('Error recording winner:', err);
    }
    
    broadcast({
        type: 'phase_change',
        phase: 'winner',
        timeLeft: gameState.timeLeft,
        winner: winnerInfo
    });
}

function getPlayersInfo() {
    const players = [];
    gameState.players.forEach((player, id) => {
        if (player.isCardConfirmed) {
            players.push({
                id: id,
                username: player.username,
                cardId: player.selectedCardId
            });
        }
    });
    return players;
}

let numberCallInterval = null;

function startNumberCalling() {
    if (numberCallInterval) clearInterval(numberCallInterval);
    
    numberCallInterval = setInterval(() => {
        if (gameState.phase === 'game') {
            const call = callNumber();
            if (call) {
                broadcast({
                    type: 'number_called',
                    number: call.number,
                    letter: call.letter,
                    calledNumbers: gameState.calledNumbers
                });
            } else {
                stopNumberCalling();
                broadcast({
                    type: 'all_numbers_called'
                });
                setTimeout(() => {
                    if (gameState.phase === 'game') {
                        startSelectionPhase();
                    }
                }, 5000);
            }
        }
    }, 3000);
}

function stopNumberCalling() {
    if (numberCallInterval) {
        clearInterval(numberCallInterval);
        numberCallInterval = null;
    }
}

async function gameLoop() {
    if (gameState.phase === 'game') {
        return;
    }
    
    gameState.timeLeft--;
    
    broadcast({
        type: 'timer_update',
        phase: gameState.phase,
        timeLeft: gameState.timeLeft
    });
    
    if (gameState.timeLeft <= 0) {
        if (gameState.phase === 'selection') {
            const confirmedPlayers = getConfirmedPlayersCount();
            
            if (confirmedPlayers >= 1) {
                startGamePhase();
                startNumberCalling();
            } else {
                await startSelectionPhase();
            }
        } else if (gameState.phase === 'winner') {
            await startSelectionPhase();
        }
    }
}

wss.on('connection', (ws) => {
    const playerId = ++playerIdCounter;
    const player = {
        id: playerId,
        userId: null,
        username: 'Guest_' + playerId,
        selectedCardId: null,
        isCardConfirmed: false,
        balance: 0
    };
    gameState.players.set(playerId, player);
    
    ws.playerId = playerId;
    
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        phase: gameState.phase,
        timeLeft: gameState.timeLeft,
        calledNumbers: gameState.calledNumbers,
        winner: gameState.winner,
        gameId: currentGameId
    }));
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players.get(playerId);
            
            switch (data.type) {
                case 'auth_telegram':
                    try {
                        const user = await User.findOrCreateByTelegram(
                            data.telegramId,
                            data.username
                        );
                        player.userId = user.id;
                        player.username = user.username;
                        player.balance = parseFloat(user.balance || 0);
                        
                        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'auth_success',
                            token: token,
                            user: {
                                id: user.id,
                                username: user.username,
                                balance: player.balance
                            }
                        }));
                    } catch (err) {
                        console.error('Auth error:', err);
                        ws.send(JSON.stringify({ type: 'auth_error', error: 'Authentication failed' }));
                    }
                    break;

                case 'auth_token':
                    try {
                        const decoded = jwt.verify(data.token, JWT_SECRET);
                        const user = await User.findById(decoded.userId);
                        
                        if (user) {
                            player.userId = user.id;
                            player.username = user.username;
                            player.balance = parseFloat(user.balance || 0);
                            
                            ws.send(JSON.stringify({
                                type: 'auth_success',
                                user: {
                                    id: user.id,
                                    username: user.username,
                                    balance: player.balance
                                }
                            }));
                        }
                    } catch (err) {
                        ws.send(JSON.stringify({ type: 'auth_error', error: 'Invalid token' }));
                    }
                    break;

                case 'register':
                    try {
                        const existingUser = await User.findByUsername(data.username);
                        if (existingUser) {
                            ws.send(JSON.stringify({ type: 'register_error', error: 'Username taken' }));
                            break;
                        }
                        
                        const newUser = await User.create(data.username, data.password);
                        player.userId = newUser.id;
                        player.username = newUser.username;
                        player.balance = 0;
                        
                        const token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'register_success',
                            token: token,
                            user: {
                                id: newUser.id,
                                username: newUser.username,
                                balance: 0
                            }
                        }));
                    } catch (err) {
                        console.error('Register error:', err);
                        ws.send(JSON.stringify({ type: 'register_error', error: 'Registration failed' }));
                    }
                    break;

                case 'login':
                    try {
                        const user = await User.findByUsername(data.username);
                        if (!user || !(await User.verifyPassword(user, data.password))) {
                            ws.send(JSON.stringify({ type: 'login_error', error: 'Invalid credentials' }));
                            break;
                        }
                        
                        player.userId = user.id;
                        player.username = user.username;
                        player.balance = parseFloat(user.balance || 0);
                        await User.updateLastLogin(user.id);
                        
                        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
                        
                        ws.send(JSON.stringify({
                            type: 'login_success',
                            token: token,
                            user: {
                                id: user.id,
                                username: user.username,
                                balance: player.balance
                            }
                        }));
                    } catch (err) {
                        console.error('Login error:', err);
                        ws.send(JSON.stringify({ type: 'login_error', error: 'Login failed' }));
                    }
                    break;
                    
                case 'set_username':
                    if (gameState.players.has(playerId)) {
                        gameState.players.get(playerId).username = data.username;
                    }
                    break;
                    
                case 'select_card':
                    if (gameState.phase === 'selection' && gameState.players.has(playerId)) {
                        gameState.players.get(playerId).selectedCardId = data.cardId;
                    }
                    break;
                    
                case 'confirm_card':
                    if (gameState.phase === 'selection' && player) {
                        if (!player.userId) {
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                error: 'Please login first' 
                            }));
                            break;
                        }
                        
                        if (player.selectedCardId) {
                            const stakeResult = await Wallet.stake(
                                player.userId, 
                                gameState.stakeAmount, 
                                currentGameId
                            );
                            
                            if (!stakeResult.success) {
                                ws.send(JSON.stringify({ 
                                    type: 'error', 
                                    error: stakeResult.error || 'Insufficient balance' 
                                }));
                                break;
                            }
                            
                            player.balance = stakeResult.balance;
                            player.isCardConfirmed = true;
                            
                            try {
                                await Game.addParticipant(
                                    currentGameId,
                                    player.userId,
                                    player.selectedCardId,
                                    gameState.stakeAmount
                                );
                            } catch (err) {
                                console.error('Error adding participant:', err);
                            }
                            
                            ws.send(JSON.stringify({
                                type: 'card_confirmed',
                                cardId: player.selectedCardId,
                                balance: player.balance
                            }));
                        }
                    }
                    break;
                    
                case 'claim_bingo':
                    if (gameState.phase === 'game' && player) {
                        if (player.isCardConfirmed && data.isValid) {
                            startWinnerDisplay({
                                userId: player.userId,
                                username: player.username,
                                cardId: player.selectedCardId
                            });
                        }
                    }
                    break;

                case 'get_balance':
                    if (player.userId) {
                        try {
                            const balance = await Wallet.getBalance(player.userId);
                            player.balance = parseFloat(balance);
                            ws.send(JSON.stringify({
                                type: 'balance_update',
                                balance: player.balance
                            }));
                        } catch (err) {
                            console.error('Balance error:', err);
                        }
                    }
                    break;

                case 'get_transactions':
                    if (player.userId) {
                        try {
                            const transactions = await Wallet.getTransactionHistory(player.userId);
                            ws.send(JSON.stringify({
                                type: 'transactions',
                                transactions: transactions
                            }));
                        } catch (err) {
                            console.error('Transactions error:', err);
                        }
                    }
                    break;

                case 'get_game_history':
                    if (player.userId) {
                        try {
                            const history = await Game.getUserGameHistory(player.userId);
                            const stats = await Game.getUserStats(player.userId);
                            ws.send(JSON.stringify({
                                type: 'game_history',
                                history: history,
                                stats: stats
                            }));
                        } catch (err) {
                            console.error('Game history error:', err);
                        }
                    }
                    break;

                case 'deposit':
                    if (player.userId && data.amount > 0) {
                        try {
                            const result = await Wallet.deposit(player.userId, data.amount);
                            if (result.success) {
                                player.balance = result.balance;
                                ws.send(JSON.stringify({
                                    type: 'deposit_success',
                                    balance: result.balance
                                }));
                            }
                        } catch (err) {
                            ws.send(JSON.stringify({ type: 'deposit_error', error: 'Deposit failed' }));
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });
    
    ws.on('close', () => {
        gameState.players.delete(playerId);
    });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const existingUser = await User.findByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        
        const user = await User.create(username, password);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { id: user.id, username: user.username, balance: 0 } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await User.findByUsername(username);
        if (!user || !(await User.verifyPassword(user, password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        await User.updateLastLogin(user.id);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        
        res.json({ 
            token, 
            user: { id: user.id, username: user.username, balance: user.balance } 
        });
    } catch (err) {
        res.status(500).json({ error: 'Login failed' });
    }
});

const PORT = process.env.PORT || 10000;

async function startServer() {
    try {
        await db.initializeDatabase();
        console.log('Database initialized');
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT}`);
            console.log('WebSocket server ready');
            
            initializeMasterNumbers();
            startSelectionPhase();
            setInterval(gameLoop, 1000);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT} (without database)`);
            console.log('WebSocket server ready');
            
            initializeMasterNumbers();
            startSelectionPhase();
            setInterval(gameLoop, 1000);
        });
    }
}

startServer();
