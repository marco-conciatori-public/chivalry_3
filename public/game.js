const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const playerListElement = document.getElementById('player-list');
const connectionStatus = document.getElementById('connection-status');
const endTurnBtn = document.getElementById('end-turn-btn');
const contextMenu = document.getElementById('context-menu');

// Context Menu Buttons
const btnAttack = document.getElementById('btn-attack');
const btnRotate = document.getElementById('btn-rotate');
const btnDeselect = document.getElementById('btn-deselect');

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

// STATE MANAGEMENT
let selectedCell = null; // {x, y}
let selectedTemplate = null;

// Interaction Modes: 'NONE', 'SELECTED', 'MENU', 'ATTACK_TARGETING', 'ROTATING'
let interactionState = 'NONE';
let validMoves = []; // Array of {x,y}
let validAttackTargets = []; // Array of {x,y}

// --- SOCKET LISTENERS ---

socket.on('init', (data) => {
    myId = data.myId;
    localState = data.state;
    connectionStatus.innerText = `Connected as ID: ${myId.substr(0,4)}...`;
    resetSelection();
    render();
    updateLegend();
    updateUIControls();
});

socket.on('update', (state) => {
    localState = state;
    // Validate selection persistence
    if (selectedCell) {
        const entity = localState.grid[selectedCell.y][selectedCell.x];
        if (!entity || entity.owner !== myId) {
            resetSelection();
        } else {
            // Re-calculate possibilities based on new state
            recalculateOptions(entity);
        }
    }
    render();
    updateLegend();
    updateUIControls();
});

// --- INPUT HANDLERS ---

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        resetSelection();
        render();
    }
});

endTurnBtn.addEventListener('click', () => {
    socket.emit('endTurn');
    resetSelection();
});

// Menu Button Handlers
btnAttack.addEventListener('click', () => {
    interactionState = 'ATTACK_TARGETING';
    hideContextMenu();
    render();
});

btnRotate.addEventListener('click', () => {
    interactionState = 'ROTATING';
    hideContextMenu();
    render();
});

btnDeselect.addEventListener('click', () => {
    resetSelection();
    render();
});

document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        if (localState.turn !== myId) return;
        resetSelection(); // Clear existing
        if (selectedTemplate === el.dataset.type) {
            // Toggle off
        } else {
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

    // Bounds check
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
        resetSelection();
        render();
        return;
    }

    if (!localState) return;
    if (localState.turn !== myId) return;

    const clickedEntity = localState.grid[y][x];

    // --- INTERACTION STATE MACHINE ---

    // 1. ROTATING MODE
    if (interactionState === 'ROTATING') {
        // Check if clicked neighbor to set direction
        if (selectedCell) {
            const dx = x - selectedCell.x;
            const dy = y - selectedCell.y;
            // Must be strictly adjacent
            if (Math.abs(dx) + Math.abs(dy) === 1) {
                let direction = 0;
                if (dy === -1) direction = 0; // N
                if (dx === 1)  direction = 2; // E
                if (dy === 1)  direction = 4; // S
                if (dx === -1) direction = 6; // W

                socket.emit('rotateEntity', { x: selectedCell.x, y: selectedCell.y, direction });
                // Reset to selected state after rotate, or deselect?
                // Prompt implies "clears the arrows". Doesn't explicitly say deselect.
                // But normally we stay selected.
                interactionState = 'SELECTED';
            } else {
                // Clicked elsewhere -> Cancel rotation, restore selection view
                interactionState = 'SELECTED';
            }
        }
        render();
        return;
    }

    // 2. ATTACK MODE
    if (interactionState === 'ATTACK_TARGETING') {
        // Check if clicked a valid target
        const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
        if (isTarget) {
            socket.emit('attackEntity', { attackerPos: selectedCell, targetPos: {x, y} });
            resetSelection(); // Usually deselect after attack
        } else {
            // Cancel attack mode
            interactionState = 'SELECTED';
        }
        render();
        return;
    }

    // 3. MENU OPEN
    if (interactionState === 'MENU') {
        // If clicked anywhere on canvas while menu is open, we close menu.
        // If clicked the unit again? Prompt says "Clicking a selected unit... opens menu".
        // If already open, maybe toggle close? Or just keep open.
        // Let's say clicking map closes menu and handles map click.
        hideContextMenu();
        interactionState = 'SELECTED';
        // Fallthrough to normal click handling...
    }

    // 4. NORMAL SELECTION / MOVEMENT

    // Clicked SAME unit? -> MENU
    if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
        showContextMenu(e.clientX, e.clientY);
        interactionState = 'MENU';
        render();
        return;
    }

    // Spawn Logic
    if (selectedTemplate && !clickedEntity) {
        socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        resetSelection();
    }
    // Select Owned Unit
    else if (clickedEntity && clickedEntity.owner === myId) {
        resetSelection();
        selectedCell = { x, y };
        interactionState = 'SELECTED';
        recalculateOptions(clickedEntity);
    }
    // Move Logic
    else if (selectedCell && !clickedEntity) {
        const isValid = validMoves.some(m => m.x === x && m.y === y);
        if (isValid) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
            // Keep selection to allow chaining
            interactionState = 'SELECTED';
        } else {
            resetSelection(); // Clicked invalid empty space
        }
    }
    else {
        resetSelection(); // Clicked enemy or invalid
    }

    render();
});

// --- HELPER FUNCTIONS ---

function resetSelection() {
    selectedCell = null;
    selectedTemplate = null;
    interactionState = 'NONE';
    validMoves = [];
    validAttackTargets = [];
    hideContextMenu();
    document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
}

function recalculateOptions(entity) {
    // Moves
    validMoves = getReachableCells(selectedCell, entity.remainingMovement, localState.grid);

    // Attacks
    validAttackTargets = [];
    if (!entity.hasAttacked) {
        validAttackTargets = getAttackableTargets(selectedCell, entity, localState.grid);
    }
}

function showContextMenu(clientX, clientY) {
    // Position menu near click, but keep within bounds
    const menuWidth = 100; // approx
    const menuHeight = 100;

    let left = clientX;
    let top = clientY;

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.display = 'flex';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
}

function getReachableCells(start, maxDist, grid) {
    if (maxDist <= 0) return [];
    let cells = [];
    let queue = [{x: start.x, y: start.y, dist: 0}];
    let visited = new Set();
    visited.add(`${start.x},${start.y}`);

    while (queue.length > 0) {
        const {x, y, dist} = queue.shift();
        if (x !== start.x || y !== start.y) cells.push({x, y});
        if (dist >= maxDist) continue;

        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                const key = `${nx},${ny}`;
                if (!visited.has(key) && !grid[ny][nx]) {
                    visited.add(key);
                    queue.push({x: nx, y: ny, dist: dist + 1});
                }
            }
        });
    }
    return cells;
}

function getAttackableTargets(start, entity, grid) {
    // Manhattan distance range check for all cells
    let targets = [];
    const range = entity.range;

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const dist = Math.abs(start.x - x) + Math.abs(start.y - y);
            if (dist <= range && dist > 0) {
                const targetEntity = grid[y][x];
                // Must be Enemy
                if (targetEntity && targetEntity.owner !== myId) {
                    targets.push({x, y});
                }
            }
        }
    }
    return targets;
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
        li.innerHTML = `<div class="player-color-box" style="background-color: ${p.color}"></div>
                        <span>${isMe ? "You" : "Player"}</span>
                        ${isTurn ? '<span class="current-turn-marker">TURN</span>' : ''}`;
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

// --- RENDER ---

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

            // 1. Cell Background (Owner Color)
            if (entity) {
                const ownerData = localState.players[entity.owner];
                const color = ownerData ? ownerData.color : '#999';
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }

            // 2. Selection Highlight
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.strokeStyle = "gold";
                ctx.lineWidth = 3;
                ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.lineWidth = 1;
            }

            // 3. Mode-Specific Overlays

            // A. ROTATION ARROWS
            if (interactionState === 'ROTATING' && selectedCell) {
                // If this cell is adjacent to selectedCell, draw arrow
                const dx = x - selectedCell.x;
                const dy = y - selectedCell.y;
                if (Math.abs(dx) + Math.abs(dy) === 1) {
                    drawRotationArrow(ctx, x, y, dx, dy);
                }
            }

            // B. ATTACK TARGETS
            else if (interactionState === 'ATTACK_TARGETING') {
                const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
                if (isTarget) {
                    // Red Ticker Contour
                    ctx.strokeStyle = "red";
                    ctx.lineWidth = 3;
                    ctx.setLineDash([5, 5]); // Ticker effect
                    ctx.strokeRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                    ctx.setLineDash([]); // Reset
                    ctx.lineWidth = 1;

                    // Light red tint
                    ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
                    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                }
            }

            // C. MOVE HINTS (Standard Selected Mode)
            else if (interactionState === 'SELECTED' || interactionState === 'MENU') {
                const isReachable = validMoves.some(m => m.x === x && m.y === y);
                if (selectedCell && isReachable && !entity) {
                    ctx.fillStyle = "rgba(46, 204, 113, 0.2)";
                    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                    ctx.beginPath();
                    ctx.arc(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2, 4, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(46, 204, 113, 0.6)";
                    ctx.fill();
                }
            }

            // 4. Grid Lines
            ctx.strokeStyle = "#ddd";
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            // 5. Entity Icon
            if (entity) {
                // Dim if no movement or exhausted
                // If hasAttacked, they are usually fully done
                if (entity.remainingMovement <= 0 && entity.hasAttacked) {
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

                // Facing Indicator
                // Only show bright facing if we have movement, else gray
                drawFacingIndicator(ctx, x, y, entity.facing_direction, entity.remainingMovement > 0);

                // Health Bar (Optional but useful for attack context)
                drawHealthBar(ctx, x, y, entity.current_health, entity.max_health);

                ctx.globalAlpha = 1.0;
            }
        }
    }
}

function drawFacingIndicator(ctx, gridX, gridY, direction, isActive) {
    const cx = gridX * CELL_SIZE + (CELL_SIZE / 2);
    const cy = gridY * CELL_SIZE + (CELL_SIZE / 2);
    const radius = CELL_SIZE / 2.5;

    ctx.save();
    ctx.translate(cx, cy);

    let rotation = 0;
    if (direction === 0) rotation = -Math.PI / 2;
    if (direction === 2) rotation = 0;
    if (direction === 4) rotation = Math.PI / 2;
    if (direction === 6) rotation = Math.PI;

    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(radius - 6, -4);
    ctx.lineTo(radius - 6, 4);
    ctx.closePath();
    ctx.fillStyle = isActive ? "#FFD700" : "#555";
    ctx.fill();
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
}

function drawRotationArrow(ctx, gridX, gridY, dx, dy) {
    const cx = gridX * CELL_SIZE + (CELL_SIZE / 2);
    const cy = gridY * CELL_SIZE + (CELL_SIZE / 2);

    ctx.save();
    ctx.translate(cx, cy);

    // Rotate to point away from center (the adjacent cell center relative to unit)
    // Actually we want arrows pointing OUT from the unit?
    // User said "displays 4 arrows around in the cells around the unit".
    // Usually these indicate "Click here to face this way".
    // So if I am at (0,0) relative, and draw at (1,0) [East], the arrow should point East.
    let rotation = 0;
    if (dx === 1) rotation = 0;
    if (dx === -1) rotation = Math.PI;
    if (dy === 1) rotation = Math.PI/2;
    if (dy === -1) rotation = -Math.PI/2;

    ctx.rotate(rotation);

    // Draw Arrow
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-5, 7);
    ctx.lineTo(-5, -7);
    ctx.fill();

    ctx.restore();
}

function drawHealthBar(ctx, gridX, gridY, current, max) {
    const barWidth = CELL_SIZE - 8;
    const barHeight = 4;
    const x = gridX * CELL_SIZE + 4;
    const y = gridY * CELL_SIZE + CELL_SIZE - 8;

    const pct = Math.max(0, current / max);

    ctx.fillStyle = "red";
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(x, y, barWidth * pct, barHeight);
}