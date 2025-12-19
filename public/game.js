const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const playerListElement = document.getElementById('player-list');
const connectionStatus = document.getElementById('connection-status');
const endTurnBtn = document.getElementById('end-turn-btn');

const GRID_SIZE = 10;
const CELL_SIZE = canvas.width / GRID_SIZE;
const icons = {
    knight: '⚔️',
    archer: '🏹',
    wizard: '🧙',
    scout: '🏇'
};

let myId = null;
let localState = null;
let selectedCell = null; // {x, y}
let selectedTemplate = null; // 'knight', etc.
let validMoves = []; // Array of {x,y}

socket.on('init', (data) => {
    myId = data.myId;
    localState = data.state;
    connectionStatus.innerText = `Connected as ID: ${myId.substr(0,4)}...`;
    render();
    updateLegend();
    updateUIControls();
});

socket.on('update', (state) => {
    localState = state;
    // If our selection is no longer valid (e.g., unit died or moved), deselect
    if (selectedCell) {
        const entity = localState.grid[selectedCell.y][selectedCell.x];
        if (!entity || entity.owner !== myId) {
            deselectAll();
        }
    }
    render();
    updateLegend();
    updateUIControls();
});

// DESELECT: Add Escape key handler
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        deselectAll();
        render();
    }
});

// END TURN BUTTON
endTurnBtn.addEventListener('click', () => {
    socket.emit('endTurn');
    deselectAll();
});

function deselectAll() {
    selectedCell = null;
    selectedTemplate = null;
    validMoves = [];
    document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
}

// Select a template from the UI
document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        // Can only select templates if it's my turn
        if (localState.turn !== myId) return;

        // If clicking the same one, toggle it off
        if (selectedTemplate === el.dataset.type) {
            deselectAll();
        } else {
            // Deselect any board entities first
            selectedCell = null;
            validMoves = [];
            document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
            el.classList.add('selected-template');
            selectedTemplate = el.dataset.type;
        }
        render();
    });
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);

    // Safety check: ensure localState exists
    if (!localState) return;

    // Prevent interaction if not my turn
    if (localState.turn !== myId) return;

    const clickedEntity = localState.grid[y][x];

    // DESELECT: If clicking the currently selected cell, deselect it
    if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
        deselectAll();
        render();
        return;
    }

    // CASE 1: Spawn an entity
    if (selectedTemplate && !clickedEntity) {
        socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        deselectAll(); // Auto deselect after action
    }
    // CASE 2: Select an owned entity to move
    else if (clickedEntity && clickedEntity.owner === myId) {
        // CHECK IF ALREADY MOVED
        if (clickedEntity.hasMoved) {
            console.log("This unit has already moved this turn.");
            return;
        }

        // Clear template selection if any
        if (selectedTemplate) {
            document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
            selectedTemplate = null;
        }

        selectedCell = { x, y };
        // Calculate valid moves based on speed
        validMoves = getReachableCells(selectedCell, clickedEntity.speed, localState.grid);
    }
    // CASE 3: Move a previously selected entity
    else if (selectedCell && !clickedEntity) {
        // Check if the click is in validMoves
        const isValid = validMoves.some(m => m.x === x && m.y === y);
        if (isValid) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
            deselectAll();
        } else {
            // Clicked outside range, deselect
            deselectAll();
        }
    }
    // CASE 4: Clicking opponent or empty space without valid action -> Deselect
    else {
        deselectAll();
    }

    render();
});

function getReachableCells(start, speed, grid) {
    let cells = [];
    let queue = [{x: start.x, y: start.y, dist: 0}];
    let visited = new Set();
    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
        const {x, y, dist} = queue.shift();

        // Add to valid moves if it's not the start point
        if (x !== start.x || y !== start.y) {
            cells.push({x, y});
        }

        if (dist >= speed) continue;

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                const key = `${nx},${ny}`;
                // Can only move into empty cells
                if (!visited.has(key) && !grid[ny][nx]) {
                    visited.add(key);
                    queue.push({x: nx, y: ny, dist: dist + 1});
                }
            }
        }
    }
    return cells;
}

function updateLegend() {
    if (!localState || !localState.players) return;

    playerListElement.innerHTML = '';

    Object.keys(localState.players).forEach(id => {
        const p = localState.players[id];
        const isMe = id === myId;
        const isTurn = localState.turn === id;

        const li = document.createElement('li');
        li.className = 'player-item';
        // Highlight active player
        if (isTurn) {
            li.style.border = '2px solid #333';
            li.style.fontWeight = 'bold';
        }

        li.innerHTML = `
            <div class="player-color-box" style="background-color: ${p.color}"></div>
            <span>${isMe ? "You" : "Player"}</span>
            ${isTurn ? '<span class="current-turn-marker">TURN</span>' : ''}
        `;
        playerListElement.appendChild(li);
    });
}

function updateUIControls() {
    if (!localState) return;
    const isMyTurn = localState.turn === myId;

    // Enable/Disable End Turn Button
    endTurnBtn.disabled = !isMyTurn;

    // Visual cue for toolbar
    const toolbar = document.getElementById('toolbar');
    toolbar.style.opacity = isMyTurn ? '1' : '0.5';
    toolbar.style.pointerEvents = isMyTurn ? 'auto' : 'none';
}

function render() {
    if (!localState) return;

    // Update the status message
    if (localState.turn === myId) {
        status.innerText = "YOUR TURN";
        status.style.color = "#27ae60";
    } else {
        status.innerText = "Opponent's Turn...";
        status.style.color = "#c0392b";
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const entity = localState.grid[y][x];

            // 1. Draw Cell Background (Logic: Occupied cells get player color)
            if (entity) {
                const ownerData = localState.players[entity.owner];
                const color = ownerData ? ownerData.color : '#999';

                // Draw background with opacity
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }

            // 2. Highlight selected cell (Yellow Border/Overlay)
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.4)"; // Gold highlight
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.strokeStyle = "gold";
                ctx.lineWidth = 3;
                ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.lineWidth = 1; // Reset
            }

            // 3. Highlight valid moves
            const isReachable = validMoves.some(m => m.x === x && m.y === y);
            if (selectedCell && isReachable && !entity) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.2)"; // Green move hint
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                // Optional: small dot in center
                ctx.beginPath();
                ctx.arc(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2, 4, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(46, 204, 113, 0.6)";
                ctx.fill();
            }

            // 4. Draw Grid Lines
            ctx.strokeStyle = "#ddd";
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            // 5. Draw Entity Icon
            if (entity) {
                // Dim the unit if it has already moved
                if (entity.hasMoved) {
                    ctx.globalAlpha = 0.4; // Make exhausted units transparent
                }

                ctx.fillStyle = "#000";

                // CENTER THE ICON
                ctx.font = "24px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const icon = icons[entity.type] || '❓';

                // Calculate center of the cell
                const centerX = x * CELL_SIZE + (CELL_SIZE / 2);
                const centerY = y * CELL_SIZE + (CELL_SIZE / 2);

                ctx.fillText(icon, centerX, centerY);

                ctx.globalAlpha = 1.0; // Reset alpha
            }
        }
    }
}