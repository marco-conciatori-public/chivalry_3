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
    if (selectedCell) {
        const entity = localState.grid[selectedCell.y][selectedCell.x];
        // Deselect if unit is gone or no longer ours
        if (!entity || entity.owner !== myId) {
            deselectAll();
        }
            // Re-calculate valid moves if we still have the unit selected
        // (in case remainingMovement changed or obstacles appeared)
        else {
            validMoves = getReachableCells(selectedCell, entity.remainingMovement, localState.grid);
        }
    }
    render();
    updateLegend();
    updateUIControls();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        deselectAll();
        render();
    }
});

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

document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        if (localState.turn !== myId) return;

        if (selectedTemplate === el.dataset.type) {
            deselectAll();
        } else {
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

    if (!localState) return;
    if (localState.turn !== myId) return;

    const clickedEntity = localState.grid[y][x];

    if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
        deselectAll();
        render();
        return;
    }

    // CASE 1: Spawn
    if (selectedTemplate && !clickedEntity) {
        socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        deselectAll();
    }
    // CASE 2: Select Unit
    else if (clickedEntity && clickedEntity.owner === myId) {
        if (selectedTemplate) {
            document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
            selectedTemplate = null;
        }
        selectedCell = { x, y };
        // Use remainingMovement for range
        validMoves = getReachableCells(selectedCell, clickedEntity.remainingMovement, localState.grid);
    }
    // CASE 3: Move
    else if (selectedCell && !clickedEntity) {
        const isValid = validMoves.some(m => m.x === x && m.y === y);
        if (isValid) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
            // Do NOT deselect automatically, allows chaining moves
        } else {
            deselectAll();
        }
    }
    else {
        deselectAll();
    }

    render();
});

function getReachableCells(start, maxDist, grid) {
    if (maxDist <= 0) return [];

    let cells = [];
    let queue = [{x: start.x, y: start.y, dist: 0}];
    let visited = new Set();
    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
        const {x, y, dist} = queue.shift();

        if (x !== start.x || y !== start.y) {
            cells.push({x, y});
        }

        if (dist >= maxDist) continue;

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                const key = `${nx},${ny}`;
                // Can only move through empty spaces
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
    endTurnBtn.disabled = !isMyTurn;
    const toolbar = document.getElementById('toolbar');
    toolbar.style.opacity = isMyTurn ? '1' : '0.5';
    toolbar.style.pointerEvents = isMyTurn ? 'auto' : 'none';
}

function render() {
    if (!localState) return;

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

            // 1. Draw Cell Background
            if (entity) {
                const ownerData = localState.players[entity.owner];
                const color = ownerData ? ownerData.color : '#999';
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }

            // 2. Highlight selected
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.strokeStyle = "gold";
                ctx.lineWidth = 3;
                ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.lineWidth = 1;
            }

            // 3. Highlight valid moves
            const isReachable = validMoves.some(m => m.x === x && m.y === y);
            if (selectedCell && isReachable && !entity) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.2)";
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.beginPath();
                ctx.arc(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2, 4, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(46, 204, 113, 0.6)";
                ctx.fill();
            }

            // 4. Draw Grid Lines
            ctx.strokeStyle = "#ddd";
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            // 5. Draw Entity
            if (entity) {
                // Dim if no movement left
                if (entity.remainingMovement <= 0) {
                    ctx.globalAlpha = 0.4;
                }

                ctx.fillStyle = "#000";
                ctx.font = "24px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const icon = icons[entity.type] || '❓';
                const centerX = x * CELL_SIZE + (CELL_SIZE / 2);
                const centerY = y * CELL_SIZE + (CELL_SIZE / 2);

                ctx.fillText(icon, centerX, centerY);

                // --- FACING INDICATOR ---
                drawFacingIndicator(ctx, x, y, entity.facing_direction, entity.remainingMovement > 0);

                ctx.globalAlpha = 1.0;
            }
        }
    }
}

// Draw a small arrow indicating facing direction
function drawFacingIndicator(ctx, gridX, gridY, direction, isActive) {
    const cx = gridX * CELL_SIZE + (CELL_SIZE / 2);
    const cy = gridY * CELL_SIZE + (CELL_SIZE / 2);
    const radius = CELL_SIZE / 2.5; // push indicator to edge

    ctx.save();
    ctx.translate(cx, cy);

    // direction: 0=N, 2=E, 4=S, 6=W
    // Map 0-7 to radians. 0 is North (-PI/2)
    // direction * (360/8) = degrees.
    // 0 -> -90deg, 2 -> 0deg, 4 -> 90deg, 6 -> 180deg

    // Easier mapping:
    let rotation = 0;
    if (direction === 0) rotation = -Math.PI / 2;
    if (direction === 2) rotation = 0;
    if (direction === 4) rotation = Math.PI / 2;
    if (direction === 6) rotation = Math.PI;

    ctx.rotate(rotation);

    // Draw Triangle at the edge
    ctx.beginPath();
    ctx.moveTo(radius, 0);       // Tip
    ctx.lineTo(radius - 6, -4);  // Left corner
    ctx.lineTo(radius - 6, 4);   // Right corner
    ctx.closePath();

    ctx.fillStyle = isActive ? "#FFD700" : "#555"; // Gold if active, gray if exhausted
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
}