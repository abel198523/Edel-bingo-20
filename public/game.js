const LANDING_SCREEN = 'landing-screen';
const SELECTION_SCREEN = 'selection-screen';
const GAME_SCREEN = 'game-screen';
const AUTH_SCREEN = 'auth-screen';

let masterNumbers = [];
let calledNumbers = [];
let playerCard = [];
let markedCells = new Set();

let currentStake = 10;
let selectedCardId = null;
let isCardConfirmed = false;
let hasPlayerCard = false;
let myPlayerId = null;
let myUserId = null;
let myUsername = 'Guest';
let myBalance = 0;
let authToken = null;
let isAuthenticated = false;

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

function loadSavedAuth() {
    const savedToken = localStorage.getItem('authToken');
    const savedUsername = localStorage.getItem('username');
    if (savedToken) {
        authToken = savedToken;
        myUsername = savedUsername || 'Guest';
    }
}

function saveAuth(token, username) {
    localStorage.setItem('authToken', token);
    localStorage.setItem('username', username);
    authToken = token;
    myUsername = username;
}

function clearAuth() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    authToken = null;
    isAuthenticated = false;
    myBalance = 0;
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = function() {
        console.log('Connected to server');
        reconnectAttempts = 0;
        updateConnectionStatus(true);
        
        if (tg && tg.initDataUnsafe?.user?.id) {
            ws.send(JSON.stringify({
                type: 'auth_telegram',
                telegramId: String(tg.initDataUnsafe.user.id),
                username: myUsername
            }));
        } else if (authToken) {
            ws.send(JSON.stringify({
                type: 'auth_token',
                token: authToken
            }));
        } else {
            ws.send(JSON.stringify({
                type: 'set_username',
                username: myUsername
            }));
        }
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

        case 'auth_success':
            isAuthenticated = true;
            myUserId = data.user.id;
            myUsername = data.user.username;
            myBalance = parseFloat(data.user.balance) || 0;
            if (data.token) {
                saveAuth(data.token, myUsername);
            }
            updateBalanceDisplay();
            hideAuthScreen();
            break;

        case 'auth_error':
            showError(data.error || 'Authentication failed');
            clearAuth();
            break;

        case 'login_success':
        case 'register_success':
            isAuthenticated = true;
            myUserId = data.user.id;
            myUsername = data.user.username;
            myBalance = parseFloat(data.user.balance) || 0;
            saveAuth(data.token, myUsername);
            updateBalanceDisplay();
            hideAuthScreen();
            break;

        case 'login_error':
        case 'register_error':
            showError(data.error || 'Operation failed');
            break;

        case 'balance_update':
            myBalance = parseFloat(data.balance) || 0;
            updateBalanceDisplay();
            break;

        case 'deposit_success':
            myBalance = parseFloat(data.balance) || 0;
            updateBalanceDisplay();
            showSuccess('Deposit successful!');
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
            }
            break;
            
        case 'number_called':
            calledNumbers = data.calledNumbers;
            displayCalledNumber(data.number, data.letter);
            markMasterGrid(data.number);
            updateCallHistory();
            autoMarkPlayerCard(data.number);
            break;
            
        case 'card_confirmed':
            isCardConfirmed = true;
            hasPlayerCard = true;
            if (data.balance !== undefined) {
                myBalance = parseFloat(data.balance);
                updateBalanceDisplay();
            }
            showCardConfirmedUI(data.cardId);
            break;

        case 'error':
            showError(data.error || 'An error occurred');
            break;

        case 'transactions':
            displayTransactions(data.transactions);
            break;

        case 'game_history':
            displayGameHistory(data.history, data.stats);
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

function updateBalanceDisplay() {
    const walletValues = document.querySelectorAll('#main-wallet-value, .wallet-balance');
    walletValues.forEach(el => {
        if (el) el.textContent = myBalance.toFixed(2);
    });
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
    const screens = [LANDING_SCREEN, SELECTION_SCREEN, GAME_SCREEN, AUTH_SCREEN];
    screens.forEach(id => {
        const screen = document.getElementById(id);
        if (screen) {
            screen.style.display = (id === targetId) ? 'flex' : 'none';
        }
    });
}

function showAuthScreen() {
    const authScreen = document.getElementById(AUTH_SCREEN);
    if (authScreen) {
        authScreen.style.display = 'flex';
    }
}

function hideAuthScreen() {
    const authScreen = document.getElementById(AUTH_SCREEN);
    if (authScreen) {
        authScreen.style.display = 'none';
    }
}

function goToSelectionScreen() {
    selectedCardId = null;
    isCardConfirmed = false;
    hasPlayerCard = false;
    
    document.getElementById('current-stake').textContent = currentStake;
    updateBalanceDisplay();
    
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
    if (!isAuthenticated && !tg) {
        showAuthScreen();
        return;
    }
    
    if (myBalance < currentStake) {
        showError(`Insufficient balance. You need ${currentStake} ETB to play.`);
        return;
    }
    
    switchScreen(SELECTION_SCREEN);
    document.getElementById('current-stake').textContent = currentStake;
    updateBalanceDisplay();
    
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
    
    if (!isAuthenticated) {
        showError('Please login first');
        return;
    }
    
    if (myBalance < currentStake) {
        showError(`Insufficient balance. You need ${currentStake} ETB.`);
        return;
    }
    
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

function autoMarkPlayerCard(calledNumber) {
    const cells = document.querySelectorAll('#player-bingo-card .player-cell');
    cells.forEach(cell => {
        if (parseInt(cell.dataset.number) === calledNumber) {
            cell.classList.add('callable');
        }
    });
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
    
    const prizeText = winner.prize ? `<div class="winner-prize">${winner.prize} ETB</div>` : '';
    
    winnerOverlay.innerHTML = `
        <div class="winner-content">
            <div class="winner-title">WINNER!</div>
            <div class="winner-username">${winner.username}</div>
            <div class="winner-card">Card #${winner.cardId}</div>
            ${prizeText}
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

function showError(message) {
    let errorToast = document.getElementById('error-toast');
    if (!errorToast) {
        errorToast = document.createElement('div');
        errorToast.id = 'error-toast';
        errorToast.className = 'toast error-toast';
        document.body.appendChild(errorToast);
    }
    errorToast.textContent = message;
    errorToast.style.display = 'block';
    setTimeout(() => { errorToast.style.display = 'none'; }, 3000);
}

function showSuccess(message) {
    let successToast = document.getElementById('success-toast');
    if (!successToast) {
        successToast = document.createElement('div');
        successToast.id = 'success-toast';
        successToast.className = 'toast success-toast';
        document.body.appendChild(successToast);
    }
    successToast.textContent = message;
    successToast.style.display = 'block';
    setTimeout(() => { successToast.style.display = 'none'; }, 3000);
}

function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) {
        showError('Please enter username and password');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'login',
            username: username,
            password: password
        }));
    }
}

function handleRegister() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    
    if (!username || !password) {
        showError('Please fill in all fields');
        return;
    }
    
    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }
    
    if (password.length < 4) {
        showError('Password must be at least 4 characters');
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'register',
            username: username,
            password: password
        }));
    }
}

function requestDeposit(amount) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'deposit',
            amount: parseFloat(amount)
        }));
    }
}

function requestBalance() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_balance' }));
    }
}

function requestTransactions() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_transactions' }));
    }
}

function requestGameHistory() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'get_game_history' }));
    }
}

function displayTransactions(transactions) {
    console.log('Transactions:', transactions);
}

function displayGameHistory(history, stats) {
    console.log('Game History:', history);
    console.log('Stats:', stats);
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

    document.getElementById('login-btn')?.addEventListener('click', handleLogin);
    document.getElementById('register-btn')?.addEventListener('click', handleRegister);
    
    document.getElementById('show-register')?.addEventListener('click', function() {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    });
    
    document.getElementById('show-login')?.addEventListener('click', function() {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
    });
    
    document.getElementById('close-auth')?.addEventListener('click', hideAuthScreen);
}

document.addEventListener('DOMContentLoaded', function() {
    loadSavedAuth();
    setupEventListeners();
    document.getElementById('start-selection-btn').textContent = `▷ Play ${currentStake} ETB`;
    
    connectWebSocket();
    
    switchScreen(LANDING_SCREEN);
});
