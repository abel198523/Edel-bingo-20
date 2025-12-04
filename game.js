
const LANDING_SCREEN = 'landing-screen';
const SELECTION_SCREEN = 'selection-screen';
const GAME_SCREEN = 'game-screen';

let masterNumbers = [];
let calledNumbers = [];
let playerCard = [];
let markedCells = new Set();

let currentStake = 10;
let selectedCardId = null;
let isCardConfirmed = false;
let hasPlayerCard = false;
let myPlayerId = null;
let myUsername = 'Guest';

let ws = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

let tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    if (tg.initDataUnsafe?.user?.username) {
        myUsername = tg.initDataUnsafe.user.username;
    } else if (tg.initDataUnsafe?.user?.first_name) {
        myUsername = tg.initDataUnsafe.user.first_name;
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('Connected to server');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
        
        ws.send(JSON.stringify({
            type: 'set_username',
            username: myUsername
        }));
    };
    
    ws.onclose = function() {
        console.log('Disconnected from server');
        updateConnectionStatus(false);
        
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(connectWebSocket, 2000);
        }
    };
    
    ws.onerror = function(error) {
        console.error('WebSocket error:', error);
    };
    
    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'init':
            myPlayerId = data.playerId;
            handlePhaseSync(data.phase, data.timeLeft, data.calledNumbers, data.winner);
            break;
            
        case 'phase_change':
            if (data.phase === 'selection') {
                goToSelectionScreen();
            } else if (data.phase === 'game') {
                goToGameScreen();
            } else if (data.phase === 'winner') {
                showWinnerAnnouncement(data.winner);
            }
            updateTimer(data.timeLeft);
            break;
            
        case 'timer_update':
            updateTimer(data.timeLeft);
            if (data.phase === 'selection') {
                hideWinnerAnnouncement();
                if (document.getElementById(SELECTION_SCREEN).style.display !== 'flex') {
                    goToSelectionScreen();
                }
            } else if (data.phase === 'game') {
                hideWinnerAnnouncement();
                if (document.getElementById(GAME_SCREEN).style.display !== 'flex') {
                    goToGameScreen();
                }
            } else if (data.phase === 'winner') {
            }
            break;
            
        case 'number_called':
            calledNumbers = data.calledNumbers;
            displayCalledNumber(data.number, data.letter);
            markMasterGrid(data.number);
            updateCallHistory();
            break;
            
        case 'card_confirmed':
            isCardConfirmed = true;
            hasPlayerCard = true;
            showCardConfirmedUI(data.cardId);
            break;
    }
}

function handlePhaseSync(phase, timeLeft, serverCalledNumbers, winner) {
    calledNumbers = serverCalledNumbers || [];
    
    if (phase === 'selection') {
        hideWinnerAnnouncement();
        goToSelectionScreen();
    } else if (phase === 'game') {
        hideWinnerAnnouncement();
        goToGameScreen();
        initializeMasterGrid();
        calledNumbers.forEach(num => markMasterGrid(num));
        if (calledNumbers.length > 0) {
            const lastNum = calledNumbers[calledNumbers.length - 1];
            displayCalledNumber(lastNum, getLetterForNumber(lastNum));
        }
        updateCallHistory();
    } else if (phase === 'winner') {
        switchScreen(GAME_SCREEN);
        if (winner) {
            showWinnerAnnouncement(winner);
        }
    }
    
    updateTimer(timeLeft);
}

function updateConnectionStatus(connected) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.connection-status span:last-child');
    
    if (statusDot && statusText) {
        if (connected) {
            statusDot.classList.remove('disconnected');
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected';
        } else {
            statusDot.classList.remove('connected');
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Reconnecting...';
        }
    }
}

function updateTimer(timeLeft) {
    const selectionTimer = document.getElementById('time-left');
    if (selectionTimer) {
        if (timeLeft <= 0) {
            selectionTimer.textContent = 'GO!';
        } else {
            selectionTimer.textContent = `${timeLeft}s`;
        }
    }
}

function switchScreen(targetId) {
    const screens = [LANDING_SCREEN, SELECTION_SCREEN, GAME_SCREEN];
    screens.forEach(id => {
        const screen = document.getElementById(id);
        if (screen) {
            screen.style.display = (id === targetId) ? 'flex' : 'none';
        }
    });
}

function goToSelectionScreen() {
    selectedCardId = null;
    isCardConfirmed = false;
    hasPlayerCard = false;
    
    document.getElementById('current-stake').textContent = currentStake;
    
    switchScreen(SELECTION_SCREEN);
    initializeSelectionGrid();
    hideWinnerAnnouncement();
}

function goToGameScreen() {
    switchScreen(GAME_SCREEN);
    initializeMasterGrid();
    generatePlayerCard(selectedCardId);
    hideWinnerAnnouncement();
}

function handleStakeSelection(event) {
    document.querySelectorAll('.stake-btn').forEach(btn => {
        btn.classList.remove('active-stake');
    });

    event.target.classList.add('active-stake');
    currentStake = parseInt(event.target.dataset.stake);
    
    const playBtn = document.getElementById('start-selection-btn');
    playBtn.textContent = `▷ Play ${currentStake} ETB`;
}

function joinGame() {
    switchScreen(SELECTION_SCREEN);
    document.getElementById('current-stake').textContent = currentStake;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        initializeSelectionGrid();
    }
}

function initializeSelectionGrid() {
    const grid = document.getElementById('card-selection-grid');
    const confirmBtn = document.getElementById('confirm-card-btn');
    const statusEl = document.getElementById('confirmation-status');

    if (!isCardConfirmed) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'ካርዱን አረጋግጥ';
        statusEl.textContent = 'ካርድ ይምረጡና አረጋግጡ';
    }
    
    grid.innerHTML = '';
    
    for (let i = 1; i <= 99; i++) {
        const cell = document.createElement('div');
        cell.className = 'card-select-cell';
        cell.textContent = i;
        cell.dataset.cardId = i;
        
        if (isCardConfirmed && parseInt(selectedCardId) === i) {
            cell.classList.add('selected');
        } else if (Math.random() < 0.2) {
            cell.classList.add('taken');
        } else if (!isCardConfirmed) {
            cell.addEventListener('click', function() { selectCard(cell); });
        }
        
        grid.appendChild(cell);
    }
}

function selectCard(cell) {
    const cardId = cell.dataset.cardId;
    const confirmBtn = document.getElementById('confirm-card-btn');
    const statusEl = document.getElementById('confirmation-status');

    if (cell.classList.contains('taken') || isCardConfirmed) {
        return;
    }
    
    if (selectedCardId) {
        const prevSelected = document.querySelector(`.card-select-cell[data-card-id="${selectedCardId}"]`);
        prevSelected?.classList.remove('selected');
    }

    cell.classList.add('selected');
    selectedCardId = cardId;
    
    confirmBtn.disabled = false;
    statusEl.textContent = `Card ${cardId} ተመርጧል። ለማረጋገጥ ይጫኑ።`;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'select_card',
            cardId: cardId
        }));
    }
}

function handleCardConfirmation() {
    if (!selectedCardId || isCardConfirmed) return;
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'confirm_card',
            cardId: selectedCardId
        }));
    }
}

function showCardConfirmedUI(cardId) {
    const confirmBtn = document.getElementById('confirm-card-btn');
    const statusEl = document.getElementById('confirmation-status');
    
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'ካርድዎ ተረጋግጧል።';
    statusEl.textContent = `ካርድ ${cardId} ተረጋግጧል። ጨዋታው እስኪጀመር ይጠብቁ።`;
    
    document.querySelectorAll('.card-select-cell').forEach(cell => {
        const newCell = cell.cloneNode(true);
        cell.parentNode.replaceChild(newCell, cell);
    });
    
    const confirmedCell = document.querySelector(`.card-select-cell[data-card-id="${cardId}"]`);
    if(confirmedCell) confirmedCell.classList.add('selected');
}

function getLetterForNumber(num) {
    if (num >= 1 && num <= 15) return 'B';
    if (num >= 16 && num <= 30) return 'I';
    if (num >= 31 && num <= 45) return 'N';
    if (num >= 46 && num <= 60) return 'G';
    if (num >= 61 && num <= 75) return 'O';
    return '';
}

function getColumnClass(num) {
    const letter = getLetterForNumber(num);
    return `col-${letter.toLowerCase()}`;
}

function getCallClass(num) {
    const letter = getLetterForNumber(num);
    return `${letter.toLowerCase()}-call`;
}

function initializeMasterGrid() {
    const masterGrid = document.getElementById('master-grid');
    masterGrid.innerHTML = '';
    masterNumbers = [];
    
    for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 5; col++) {
            const number = (col * 15) + row + 1;
            const cell = document.createElement('div');
            cell.className = 'master-cell';
            cell.textContent = number;
            cell.dataset.number = number;
            masterGrid.appendChild(cell);
            masterNumbers.push(number);
        }
    }
    
    document.getElementById('call-letter').textContent = '';
    document.getElementById('call-number').textContent = '--';
}

function markMasterGrid(number) {
    document.querySelectorAll('.master-cell').forEach(cell => {
        if (parseInt(cell.dataset.number) === number) {
            cell.classList.add('called');
        }
    });
}

function displayCalledNumber(number, letter) {
    document.getElementById('call-letter').textContent = letter;
    document.getElementById('call-number').textContent = number;
    
    const callCircle = document.getElementById('current-call');
    callCircle.className = 'current-call-circle';
}

function generatePlayerCard(cardId = null) {
    const playerCardEl = document.getElementById('player-bingo-card');
    const watchPlacard = document.getElementById('watch-only-placard');
    const cardTitle = document.getElementById('card-number-title');
    
    if (!hasPlayerCard || !cardId) {
        playerCardEl.innerHTML = '';
        watchPlacard.style.display = 'flex';
        cardTitle.textContent = 'Card Number --';
        return;
    }

    watchPlacard.style.display = 'none';
    playerCardEl.innerHTML = '';
    playerCard = [];
    markedCells.clear();
    
    cardTitle.textContent = `Card Number ${cardId}`;
    
    const cardData = BINGO_CARDS[cardId];
    if (!cardData) {
        console.error('Card not found:', cardId);
        watchPlacard.style.display = 'flex';
        return;
    }
    
    const colLetters = ['b', 'i', 'n', 'g', 'o'];
    
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const cell = document.createElement('div');
            cell.className = `player-cell col-${colLetters[col]}`;
            
            const number = cardData[row][col];
            
            if (number === 0) {
                cell.textContent = 'F';
                cell.classList.add('free-space', 'marked');
                cell.dataset.number = 'free';
                markedCells.add('free');
            } else {
                cell.textContent = number;
                cell.dataset.number = number;
                playerCard.push(number);
                
                if (calledNumbers.includes(number)) {
                    cell.classList.add('callable');
                }
                
                cell.addEventListener('click', function() {
                    toggleCell(cell);
                });
            }
            
            playerCardEl.appendChild(cell);
        }
    }
}

function toggleCell(cell) {
    const number = cell.dataset.number;
    
    if (number === 'free') return;
    
    if (!calledNumbers.includes(parseInt(number))) {
        return; 
    }
    
    if (cell.classList.contains('marked')) {
        cell.classList.remove('marked');
        markedCells.delete(number);
    } else {
        cell.classList.add('marked');
        markedCells.add(number);
        checkForBingo();
    }
}

function updateCallHistory() {
    const historyContainer = document.getElementById('call-history');
    historyContainer.innerHTML = '';
    
    const lastCalls = calledNumbers.slice(-4).reverse();
    
    lastCalls.forEach(num => {
        const letter = getLetterForNumber(num);
        const item = document.createElement('span');
        item.className = `history-item ${getCallClass(num)}`;
        item.innerHTML = `<span>${letter}-${num}</span>`;
        historyContainer.appendChild(item);
    });
}

function checkForBingo() {
    const grid = Array(5).fill().map(() => Array(5).fill(false));
    const playerCells = document.querySelectorAll('#player-bingo-card .player-cell');
    
    playerCells.forEach((cell, index) => {
        const row = Math.floor(index / 5);
        const col = index % 5;
        
        if (cell.classList.contains('marked')) {
            grid[row][col] = true;
        }
    });

    for (let i = 0; i < 5; i++) {
        if (grid[i].every(cell => cell)) return true;
        if (grid.every(row => row[i])) return true;
    }
    if (grid[0][0] && grid[1][1] && grid[2][2] && grid[3][3] && grid[4][4]) return true;
    if (grid[0][4] && grid[1][3] && grid[2][2] && grid[3][1] && grid[4][0]) return true;
    
    return false;
}

function showWinnerAnnouncement(winner) {
    let winnerOverlay = document.getElementById('winner-overlay');
    
    if (!winnerOverlay) {
        winnerOverlay = document.createElement('div');
        winnerOverlay.id = 'winner-overlay';
        winnerOverlay.className = 'winner-overlay';
        document.body.appendChild(winnerOverlay);
    }
    
    winnerOverlay.innerHTML = `
        <div class="winner-content">
            <div class="winner-title">WINNER!</div>
            <div class="winner-username">${winner.username}</div>
            <div class="winner-card">Card #${winner.cardId}</div>
        </div>
    `;
    
    winnerOverlay.style.display = 'flex';
}

function hideWinnerAnnouncement() {
    const winnerOverlay = document.getElementById('winner-overlay');
    if (winnerOverlay) {
        winnerOverlay.style.display = 'none';
    }
}

function claimBingo() {
    const isValid = checkForBingo();
    
    if (isValid && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'claim_bingo',
            isValid: true
        }));
        document.getElementById('bingo-btn').textContent = 'BINGO!';
    } else {
        const bingoBtn = document.getElementById('bingo-btn');
        bingoBtn.textContent = 'Not Yet...';
        setTimeout(() => bingoBtn.textContent = 'Bingo', 1000);
    }
}

function setupEventListeners() {
    document.querySelectorAll('.stake-btn').forEach(button => {
        button.addEventListener('click', handleStakeSelection);
    });

    document.getElementById('start-selection-btn')?.addEventListener('click', joinGame);

    document.getElementById('confirm-card-btn')?.addEventListener('click', handleCardConfirmation);

    document.querySelector('.close-btn')?.addEventListener('click', function() {
        switchScreen(LANDING_SCREEN);
    });
    
    document.getElementById('exit-btn')?.addEventListener('click', function() {
        switchScreen(LANDING_SCREEN);
    });
    
    document.getElementById('refresh-btn')?.addEventListener('click', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            location.reload();
        }
    });
    
    document.getElementById('bingo-btn')?.addEventListener('click', claimBingo);
}

document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    document.getElementById('start-selection-btn').textContent = `▷ Play ${currentStake} ETB`;
    
    connectWebSocket();
    
    switchScreen(LANDING_SCREEN);
});
