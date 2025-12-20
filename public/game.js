const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const playerListElement = document.getElementById('player-list');
const connectionStatus = document.getElementById('connection-status');
const endTurnBtn = document.getElementById('end-turn-btn');
const contextMenu = document.getElementById('context-menu');
const unitInfoContent = document.getElementById('unit-info-content');

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
let clientUnitStats = {}; // Store stats received from server

// STATE MANAGEMENT
let selectedCell = null; // {x, y}
let selectedTemplate = null;

// Interaction Modes: 'NONE', 'SELECTED', 'MENU', 'ATTACK_TARGETING', 'ROTATING'
let interactionState = 'NONE';
let validMoves = []; // Array of {x,y}
let validAttackTargets = []; // Array of {x,y}
let cellsInAttackRange = []; // Array of {x,y}

// --- SOCKET LISTENERS ---

socket.on('init', (data) => {
    myId = data.myId;
    localState = data.state;
    clientUnitStats = data.unitStats; // Save stats for templates
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
        // Note: We now allow selecting ANY unit, even if null (though null check handles below)
        // If entity disappeared (died), deselect
        if (!entity) {
            resetSelection();
        } else {
            // Re-calculate possibilities based on new state
            recalculateOptions(entity);
            updateUnitInfo(entity, false); // Update sidebar (false = not template)
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

// Template (Spawn Button) Selection
document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        // Can only select templates if it's my turn
        if (localState.turn !== myId) return;

        resetSelection(); // Deselect grid units and other templates

        el.classList.add('selected-template');
        selectedTemplate = el.dataset.type;

        // Show info for this template
        if (clientUnitStats[selectedTemplate]) {
            updateUnitInfo(clientUnitStats[selectedTemplate], true);
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

    const clickedEntity = localState.grid[y][x];

    // --- INTERACTION STATE MACHINE ---

    // 1. ROTATING MODE
    if (interactionState === 'ROTATING') {
        if (selectedCell) {
            const dx = x - selectedCell.x;
            const dy = y - selectedCell.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) {
                let direction = 0;
                if (dy === -1) direction = 0; // N
                if (dx === 1)  direction = 2; // E
                if (dy === 1)  direction = 4; // S
                if (dx === -1) direction = 6; // W

                socket.emit('rotateEntity', { x: selectedCell.x, y: selectedCell.y, direction });
                interactionState = 'SELECTED';
            } else {
                interactionState = 'SELECTED';
            }
        }
        render();
        return;
    }

    // 2. ATTACK MODE
    if (interactionState === 'ATTACK_TARGETING') {
        const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
        if (isTarget) {
            socket.emit('attackEntity', { attackerPos: selectedCell, targetPos: {x, y} });
            resetSelection();
        } else {
            interactionState = 'SELECTED';
        }
        render();
        return;
    }

    // 3. MENU OPEN
    if (interactionState === 'MENU') {
        hideContextMenu();
        interactionState = 'SELECTED';

        // Toggle off: If clicking the same unit that opened the menu, stop here (menu stays closed).
        if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
            render();
            return;
        }
        // Fallthrough to normal click processing
    }

    // 4. NORMAL SELECTION / MOVEMENT

    // Clicked SAME unit? -> MENU (Only if we own it and it's our turn)
    if (clickedEntity && selectedCell && selectedCell.x === x && selectedCell.y === y) {
        if (clickedEntity.owner === myId && localState.turn === myId) {
            showContextMenu(e.clientX, e.clientY, clickedEntity);
            interactionState = 'MENU';
        } else {
            // Just re-selecting same enemy/exhausted unit - do nothing or maybe refresh info
        }
        render();
        return;
    }

    // Clicked ANY Unit -> Select it (Exclusive Selection)
    if (clickedEntity) {
        resetSelection(); // Clears templates and previous grid selection
        selectedCell = { x, y };
        interactionState = 'SELECTED';

        // Show info
        updateUnitInfo(clickedEntity, false);

        // Only calculate options if we control it and it's our turn
        if (clickedEntity.owner === myId && localState.turn === myId) {
            recalculateOptions(clickedEntity);
        }
    }
    // Spawn Logic (Empty Cell + Template Selected)
    else if (selectedTemplate && !clickedEntity) {
        if (localState.turn === myId) {
            socket.emit('spawnEntity', { x, y, type: selectedTemplate });
            resetSelection();
        }
    }
    // Move Logic (Empty Cell + Unit Selected)
    else if (selectedCell && !clickedEntity) {
        // Only allow move if we have valid moves (implies we own it and it's our turn)
        const isValid = validMoves.some(m => m.x === x && m.y === y);
        if (isValid) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
            interactionState = 'SELECTED';
        } else {
            resetSelection();
        }
    }
    else {
        resetSelection();
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
    cellsInAttackRange = [];
    hideContextMenu();
    document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
    updateUnitInfo(null, false);
}

function recalculateOptions(entity) {
    // Moves
    validMoves = getReachableCells(selectedCell, entity.remainingMovement, localState.grid);

    // Attacks
    validAttackTargets = [];
    cellsInAttackRange = [];
    if (!entity.hasAttacked) {
        const range = entity.range;
        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const dist = Math.abs(selectedCell.x - x) + Math.abs(selectedCell.y - y);
                if (dist <= range && dist > 0) {
                    cellsInAttackRange.push({x, y});
                    const targetEntity = localState.grid[y][x];
                    if (targetEntity && targetEntity.owner !== myId) {
                        validAttackTargets.push({x, y});
                    }
                }
            }
        }
    }
}

function showContextMenu(clientX, clientY, entity) {
    if (entity) {
        btnRotate.disabled = entity.remainingMovement < 1;
        btnAttack.disabled = entity.hasAttacked;
    }

    const gameAreaRect = document.getElementById('game-area').getBoundingClientRect();

    if (selectedCell) {
        const menuLeft = (selectedCell.x * CELL_SIZE) + CELL_SIZE + 5;
        const menuTop = (selectedCell.y * CELL_SIZE);
        contextMenu.style.left = `${menuLeft}px`;
        contextMenu.style.top = `${menuTop}px`;
    } else {
        contextMenu.style.left = `${clientX - gameAreaRect.left}px`;
        contextMenu.style.top = `${clientY - gameAreaRect.top}px`;
    }

    contextMenu.style.display = 'flex';
}

function hideContextMenu() {
    contextMenu.style.display = 'none';
}

function updateUnitInfo(entity, isTemplate) {
    if (!entity) {
        unitInfoContent.innerHTML = '<em>Click a unit to see details</em>';
        return;
    }

    const formatStat = (label, value) => `<div class="stat-row"><span>${label}:</span> <strong>${value}</strong></div>`;

    // Calculate dynamic values for display

    // Type (Template just has keys, Entity has .type)
    const type = isTemplate ? selectedTemplate : entity.type;

    // Health: Show only max for templates, Current/Max for units
    const healthDisplay = isTemplate ? entity.max_health : `${entity.current_health}/${entity.max_health}`;

    // Moves: Show only max for templates, Current/Max for units
    const movesDisplay = isTemplate ? entity.speed : `${entity.remainingMovement}/${entity.speed}`;

    // Attacks: Hide row for templates
    let attacksRow = '';
    if (!isTemplate) {
        // "Attacks 0/1" means 0 attacks left out of 1.
        const attacksLeft = entity.hasAttacked ? 0 : 1;
        attacksRow = formatStat('Attacks', `${attacksLeft}/1`);
    }

    // Morale: Show only max for templates, Current/Max for units
    const moraleDisplay = isTemplate ? entity.max_morale : `${entity.current_morale}/${entity.max_morale}`;

    // Bonus Vs
    let bonusDisplay = 'None';
    if (entity.bonus_vs && entity.bonus_vs.length > 0) {
        bonusDisplay = entity.bonus_vs.join(', ');
    }

    // Cost (Display logic: Only for templates, and placed below name)
    let costRow = '';
    if (isTemplate) {
        costRow = formatStat('Cost', entity.cost || '-');
    }

    // Extra Rows (Bonus against is always at bottom now)
    let extraRows = '';
    extraRows += formatStat('Bonus against', bonusDisplay);

    unitInfoContent.innerHTML = `
        <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 5px;">${(type || 'Unknown').toUpperCase()}</div>
        ${costRow}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
        ${formatStat('Health', healthDisplay)}
        ${formatStat('Moves', movesDisplay)}
        ${attacksRow}
        ${formatStat('Morale', moraleDisplay)}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
        ${formatStat('Attack', entity.attack)}
        ${formatStat('Defense', entity.defence)}
        ${formatStat('Range', entity.range)}
        ${extraRows}
    `;
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

        // Show Gold amount for me and others (or hide for others if desired, currently shown for all)
        const goldDisplay = p.gold !== undefined ? ` (${p.gold}g)` : '';

        li.innerHTML = `<div class="player-color-box" style="background-color: ${p.color}"></div>
                        <span>${isMe ? "You" : "Player"}${goldDisplay}</span>
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

            // 1. Cell Background
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
                const dx = x - selectedCell.x;
                const dy = y - selectedCell.y;
                if (Math.abs(dx) + Math.abs(dy) === 1) {
                    drawRotationArrow(ctx, x, y, dx, dy);
                }
            }

            // B. ATTACK TARGETS
            else if (interactionState === 'ATTACK_TARGETING') {
                const isInRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                if (isInRange) {
                    ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
                    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                }

                const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
                if (isTarget) {
                    ctx.strokeStyle = "red";
                    ctx.lineWidth = 3;
                    ctx.setLineDash([5, 5]);
                    ctx.strokeRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
                    ctx.setLineDash([]);
                    ctx.lineWidth = 1;
                }
            }

            // C. MOVE HINTS
            else if (interactionState === 'SELECTED' || interactionState === 'MENU') {
                const isReachable = validMoves.some(m => m.x === x && m.y === y);
                // Only show hints if we have selected an entity we own and it's our turn
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

                // Always show facing and health
                drawFacingIndicator(ctx, x, y, entity.facing_direction, entity.remainingMovement > 0);
                drawHealthBar(ctx, x, y, entity.current_health, entity.max_health);

                ctx.globalAlpha = 1.0;
            }
        }
    }
}

function drawFacingIndicator(ctx, gridX, gridY, direction, isActive) {
    const cx = gridX * CELL_SIZE + (CELL_SIZE / 2);
    const cy = gridY * CELL_SIZE + (CELL_SIZE / 2);
    const radius = CELL_SIZE / 2.2;

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
    ctx.lineTo(radius - 8, -6);
    ctx.lineTo(radius - 8, 6);
    ctx.closePath();
    ctx.fillStyle = isActive ? "#FFD700" : "#555";
    ctx.fill();
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawRotationArrow(ctx, gridX, gridY, dx, dy) {
    const cx = gridX * CELL_SIZE + (CELL_SIZE / 2);
    const cy = gridY * CELL_SIZE + (CELL_SIZE / 2);

    ctx.save();
    ctx.translate(cx, cy);

    let rotation = 0;
    if (dx === 1) rotation = 0;
    if (dx === -1) rotation = Math.PI;
    if (dy === 1) rotation = Math.PI/2;
    if (dy === -1) rotation = -Math.PI/2;

    ctx.rotate(rotation);

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