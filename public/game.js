const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const playerListElement = document.getElementById('player-list');
const connectionStatus = document.getElementById('connection-status');
const endTurnBtn = document.getElementById('end-turn-btn');
const contextMenu = document.getElementById('context-menu');
const unitInfoContent = document.getElementById('unit-info-content');
const logContent = document.getElementById('log-content');

// --- INJECT CUSTOM LOG STYLES ---
const style = document.createElement('style');
style.innerHTML = `
    .log-player { font-weight: bold; color: #333; }
    .log-unit { font-weight: bold; cursor: pointer; }
    .log-unit:hover { text-decoration: underline; filter: brightness(0.8); }
`;
document.head.appendChild(style);

// Context Menu Buttons
const btnAttack = document.getElementById('btn-attack');
const btnRotate = document.getElementById('btn-rotate');
const btnDeselect = document.getElementById('btn-deselect');

const GRID_SIZE = 50;
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
let currentMoraleBreakdown = null; // Store for tooltip

// STATE MANAGEMENT
let selectedCell = null; // {x, y}
let selectedTemplate = null;

let interactionState = 'NONE';
let validMoves = []; // Array of {x,y}
let validAttackTargets = []; // Array of {x,y}
let cellsInAttackRange = []; // Array of {x,y}

// --- SOCKET LISTENERS ---

socket.on('init', (data) => {
    myId = data.myId;
    localState = data.state;
    clientUnitStats = data.unitStats;
    connectionStatus.innerText = `Connected as ID: ${myId.substr(0,4)}...`;
    resetSelection();
    render();
    updateLegend();
    updateUIControls();
    addLogEntry("Welcome to Grid War!");
});

socket.on('update', (state) => {
    localState = state;
    if (selectedCell) {
        const entity = localState.grid[selectedCell.y][selectedCell.x];
        if (!entity) {
            resetSelection();
        } else {
            recalculateOptions(entity);
            updateUnitInfo(entity, false);
        }
    }
    render();
    updateLegend();
    updateUIControls();
});

socket.on('gameLog', (data) => {
    addLogEntry(data.message);
});

socket.on('combatResults', (data) => {
    if (data.logs) {
        data.logs.forEach(msg => addLogEntry(msg));
    }
    if (data.events) {
        data.events.forEach(ev => {
            if (ev.type === 'damage' || ev.type === 'death') {
                showFloatingText(ev.x, ev.y, ev.value, ev.color || 'red');
            }
        });
    }
});

// --- HELPER: Logs & Effects ---

function addLogEntry(msg) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    div.innerHTML = msg
        .replace(/{p:([^}]+)}/g, '<span class="log-player">$1</span>')
        .replace(/{u:([^:]+):(\d+):(\d+):([^}]+)}/g, (match, type, x, y, ownerId) => {
            const color = localState.players[ownerId] ? localState.players[ownerId].color : '#3498db';
            return `<span class="log-unit" style="color: ${color}" data-x="${x}" data-y="${y}">${type}</span>`;
        });

    div.querySelectorAll('.log-unit').forEach(span => {
        span.onclick = () => {
            const x = parseInt(span.dataset.x);
            const y = parseInt(span.dataset.y);
            selectUnitFromLog(x, y);
        };
    });

    logContent.appendChild(div);
    logContent.scrollTop = logContent.scrollHeight;
}

function selectUnitFromLog(x, y) {
    if (!localState) return;
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    const entity = localState.grid[y][x];
    if (!entity) return;

    resetSelection();
    selectedCell = { x, y };
    interactionState = 'SELECTED';

    updateUnitInfo(entity, false);

    if (entity && entity.owner === myId && localState.turn === myId) {
        recalculateOptions(entity);
    }
    render();
}

function showFloatingText(gridX, gridY, text, color) {
    const el = document.createElement('div');
    el.className = 'floating-text';
    el.innerText = text;
    el.style.color = color;

    const jitterX = (Math.random() * 20) - 10;
    const jitterY = (Math.random() * 20) - 10;
    const left = (gridX * CELL_SIZE) + (CELL_SIZE / 2) + jitterX;
    const top = (gridY * CELL_SIZE) + (CELL_SIZE / 2) + jitterY;

    const canvasRect = canvas.getBoundingClientRect();
    const gameAreaRect = document.getElementById('game-area').getBoundingClientRect();
    const offsetLeft = canvasRect.left - gameAreaRect.left;
    const offsetTop = canvasRect.top - gameAreaRect.top;

    el.style.left = `${offsetLeft + left}px`;
    el.style.top = `${offsetTop + top}px`;

    document.getElementById('game-area').appendChild(el);
    setTimeout(() => { el.remove(); }, 1500);
}

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
        if (el.classList.contains('disabled')) return;

        resetSelection();

        el.classList.add('selected-template');
        selectedTemplate = el.dataset.type;

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

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
        resetSelection();
        render();
        return;
    }
    if (!localState) return;

    const clickedEntity = localState.grid[y][x];

    if (interactionState === 'ROTATING') {
        if (selectedCell) {
            const dx = x - selectedCell.x;
            const dy = y - selectedCell.y;
            if (Math.abs(dx) + Math.abs(dy) === 1) {
                let direction = 0;
                if (dy === -1) direction = 0;
                if (dx === 1)  direction = 2;
                if (dy === 1)  direction = 4;
                if (dx === -1) direction = 6;

                socket.emit('rotateEntity', { x: selectedCell.x, y: selectedCell.y, direction });
                interactionState = 'SELECTED';
            } else {
                interactionState = 'SELECTED';
            }
        }
        render();
        return;
    }

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

    if (interactionState === 'MENU') {
        hideContextMenu();
        interactionState = 'SELECTED';
        if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
            render();
            return;
        }
    }

    if (clickedEntity && selectedCell && selectedCell.x === x && selectedCell.y === y) {
        if (clickedEntity.owner === myId && localState.turn === myId) {
            if (clickedEntity.is_fleeing) return;
            showContextMenu(e.clientX, e.clientY, clickedEntity);
            interactionState = 'MENU';
        }
        render();
        return;
    }

    if (clickedEntity) {
        resetSelection();
        selectedCell = { x, y };
        interactionState = 'SELECTED';

        updateUnitInfo(clickedEntity, false);

        if (clickedEntity.owner === myId && localState.turn === myId) {
            if (!clickedEntity.is_fleeing) {
                recalculateOptions(clickedEntity);
            }
        }
    }
    else if (selectedTemplate && !clickedEntity) {
        if (localState.turn === myId) {
            socket.emit('spawnEntity', { x, y, type: selectedTemplate });
            resetSelection();
        }
    }
    else if (selectedCell && !clickedEntity) {
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
    if (entity.is_fleeing) {
        validMoves = [];
        validAttackTargets = [];
        cellsInAttackRange = [];
        return;
    }

    // UPDATE: Use weighted pathfinding logic (Client-Side implementation for UI)
    validMoves = getReachableCells(selectedCell, entity.remainingMovement, localState.grid, localState.terrainMap);

    validAttackTargets = [];
    cellsInAttackRange = [];
    if (!entity.hasAttacked) {
        let range = entity.range;

        // --- CLIENT SIDE HIGH GROUND CHECK ---
        const myTerrain = localState.terrainMap[selectedCell.y][selectedCell.x];
        if (myTerrain.highGround && entity.is_ranged) {
            range += 1;
        }

        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const dist = Math.abs(selectedCell.x - x) + Math.abs(selectedCell.y - y);

                // UPDATE: Check LoS for Ranged
                let hasLoS = true;
                if (entity.is_ranged) {
                    hasLoS = clientHasLineOfSight(selectedCell, {x, y});
                }

                if (dist <= range && dist > 0 && hasLoS) {
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

// CLIENT SIDE LoS Logic (Matches Server)
function clientHasLineOfSight(start, end) {
    let x0 = start.x, y0 = start.y;
    let x1 = end.x, y1 = end.y;
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1;
    let err = dx - dy;

    while (true) {
        if ((x0 !== start.x || y0 !== start.y) && (x0 !== end.x || y0 !== end.y)) {
            if (localState.terrainMap[y0][x0].blocksLos) return false;
        }
        if (x0 === x1 && y0 === y1) break;
        let e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
    return true;
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

// Tooltip Logic
const tooltipEl = document.createElement('div');
tooltipEl.id = 'morale-tooltip';
tooltipEl.style.display = 'none';
document.body.appendChild(tooltipEl);

function showMoraleTooltip(e, breakdown) {
    if (!breakdown || breakdown.length === 0) return;
    let html = '';
    breakdown.forEach(item => {
        const colorClass = item.value >= 0 ? 'positive' : 'negative';
        const sign = item.value >= 0 ? '+' : '';
        html += `<div class="tooltip-row"><span>${item.label}</span><span class="tooltip-val ${colorClass}">${sign}${item.value}</span></div>`;
    });
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
    moveTooltip(e);
}

function moveTooltip(e) {
    tooltipEl.style.left = `${e.pageX + 15}px`;
    tooltipEl.style.top = `${e.pageY + 15}px`;
}

function hideMoraleTooltip() {
    tooltipEl.style.display = 'none';
}

function updateUnitInfo(entity, isTemplate) {
    currentMoraleBreakdown = null;
    if (!entity) {
        unitInfoContent.innerHTML = '<em>Click a unit to see details</em>';
        return;
    }
    if (!isTemplate && entity.morale_breakdown) {
        currentMoraleBreakdown = entity.morale_breakdown;
    }

    const formatStat = (label, value) => `<div class="stat-row"><span>${label}:</span> <strong>${value}</strong></div>`;

    let typeDisplay = (isTemplate ? selectedTemplate : entity.type).toUpperCase();
    if (!isTemplate && entity.is_commander) typeDisplay += ' 👑';

    const healthDisplay = isTemplate ? entity.max_health : `${entity.current_health}/${entity.max_health}`;
    const movesDisplay = isTemplate ? entity.speed : `${entity.remainingMovement}/${entity.speed}`;

    let attacksRow = '';
    if (!isTemplate) {
        const attacksLeft = entity.hasAttacked ? 0 : 1;
        attacksRow = formatStat('Attacks', `${attacksLeft}/1`);
    }

    const moraleDisplay = isTemplate ? entity.initial_morale : `${entity.current_morale}/${entity.initial_morale}`;

    let moraleRow = '';
    if (!isTemplate) {
        moraleRow = `<div class="stat-row"><span id="morale-stat-label" class="interactive-label">Morale:</span> <strong>${moraleDisplay}</strong></div>`;
    } else {
        moraleRow = formatStat('Morale', moraleDisplay);
    }

    let bonusDisplay = (entity.bonus_vs && entity.bonus_vs.length > 0) ? entity.bonus_vs.join(', ') : 'None';
    let costRow = isTemplate ? formatStat('Cost', entity.cost || '-') : '';
    let extraRows = formatStat('Bonus against', bonusDisplay);

    let statusEffect = '';
    if (!isTemplate && entity.is_fleeing) statusEffect = `<div style="color:red; font-weight:bold; margin:5px 0;">⚠ FLEEING</div>`;
    else if (!isTemplate && entity.is_commander) statusEffect = `<div style="color:gold; font-weight:bold; margin:5px 0;">♛ COMMANDER</div>`;

    // ADD TERRAIN INFO if selected
    let terrainInfo = '';
    if (!isTemplate && selectedCell && localState && localState.terrainMap) {
        const t = localState.terrainMap[selectedCell.y][selectedCell.x];
        if (t.id !== 'plains') {
            terrainInfo = `<hr style="margin:5px 0;"><div style="font-size:0.9em;">Terrain: ${t.symbol} <b>${t.id.toUpperCase()}</b><br>Def: +${t.defense}, Cost: ${t.cost}</div>`;
        }
    }

    unitInfoContent.innerHTML = `
        <div style="font-size: 1.1em; font-weight: bold; margin-bottom: 5px;">${typeDisplay}</div>
        ${statusEffect}
        ${costRow}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
        ${formatStat('Health', healthDisplay)}
        ${formatStat('Moves', movesDisplay)}
        ${attacksRow}
        ${moraleRow}
        <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
        ${formatStat('Attack', entity.attack)}
        ${formatStat('Defense', entity.defence)}
        ${formatStat('Range', entity.range)}
        ${extraRows}
        ${terrainInfo}
    `;

    if (!isTemplate) {
        const el = document.getElementById('morale-stat-label');
        if (el) {
            el.addEventListener('mouseenter', (e) => showMoraleTooltip(e, currentMoraleBreakdown));
            el.addEventListener('mousemove', moveTooltip);
            el.addEventListener('mouseleave', hideMoraleTooltip);
        }
    }
}

// CLIENT SIDE DIJKSTRA
function getReachableCells(start, maxDist, grid, terrainMap) {
    if (maxDist <= 0) return [];

    let costs = {};
    let queue = [{x: start.x, y: start.y, cost: 0}];
    costs[`${start.x},${start.y}`] = 0;
    let reachable = [];

    while(queue.length > 0) {
        queue.sort((a,b) => a.cost - b.cost);
        let current = queue.shift();

        // Add to result if it's not start
        if (current.x !== start.x || current.y !== start.y) {
            // Check if already in list to avoid duplicates
            if (!reachable.some(r => r.x === current.x && r.y === current.y)) {
                reachable.push({x: current.x, y: current.y});
            }
        }

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of dirs) {
            const nx = current.x + dx;
            const ny = current.y + dy;

            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                const key = `${nx},${ny}`;
                const t = terrainMap[ny][nx];
                if (t.cost > 10) continue; // Impassable
                if (grid[ny][nx]) continue; // Occupied

                const newCost = current.cost + t.cost;
                if (newCost <= maxDist) {
                    if (costs[key] === undefined || newCost < costs[key]) {
                        costs[key] = newCost;
                        queue.push({x: nx, y: ny, cost: newCost});
                    }
                }
            }
        }
    }
    return reachable;
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
        const goldDisplay = p.gold !== undefined ? ` (${p.gold}g)` : '';
        const colorBox = document.createElement('div');
        colorBox.className = 'player-color-box';
        colorBox.style.backgroundColor = p.color;
        const nameSpan = document.createElement('span');
        nameSpan.innerText = `${p.name}${isMe ? " (You)" : ""}${goldDisplay}`;

        if (isMe) {
            nameSpan.style.cursor = 'pointer';
            nameSpan.title = 'Double-click to rename';
            nameSpan.ondblclick = (e) => {
                e.stopPropagation();
                const input = document.createElement('input');
                input.type = 'text';
                input.value = p.name;
                input.style.maxWidth = '100px';
                input.style.padding = '2px';
                input.style.border = '1px solid #aaa';
                input.style.borderRadius = '3px';
                const save = () => {
                    const newName = input.value.trim();
                    if (newName && newName !== p.name) socket.emit('changeName', newName);
                    else updateLegend();
                };
                input.onblur = save;
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') save();
                    e.stopPropagation();
                };
                li.replaceChild(input, nameSpan);
                input.focus();
            };
        }
        const turnMarker = document.createElement('span');
        turnMarker.className = 'current-turn-marker';
        turnMarker.innerText = isTurn ? 'TURN' : '';
        li.appendChild(colorBox);
        li.appendChild(nameSpan);
        li.appendChild(turnMarker);
        playerListElement.appendChild(li);
    });
}

function updateUIControls() {
    if (!localState || !myId) return;
    const isMyTurn = localState.turn === myId;
    const myPlayer = localState.players[myId];
    endTurnBtn.disabled = !isMyTurn;
    const toolbar = document.getElementById('toolbar');
    toolbar.style.opacity = isMyTurn ? '1' : '0.5';
    toolbar.style.pointerEvents = isMyTurn ? 'auto' : 'none';

    document.querySelectorAll('.template').forEach(el => {
        const type = el.dataset.type;
        const stats = clientUnitStats[type];
        if (stats && myPlayer) {
            if (myPlayer.gold < stats.cost) el.classList.add('disabled');
            else el.classList.remove('disabled');
            const icon = type === 'knight' ? '⚔️' : type === 'archer' ? '🏹' : type === 'wizard' ? '🧙' : '🏇';
            const name = type.charAt(0).toUpperCase() + type.slice(1);
            el.innerHTML = `${icon} ${name} <span style="font-size:0.8em; color:#666;">(${stats.cost}g)</span>`;
        }
    });
}

function render() {
    if (!localState) return;

    if (localState.turn === myId) {
        status.innerText = "YOUR TURN";
        status.style.color = "#27ae60";
    } else {
        const turnPlayer = localState.players[localState.turn];
        const turnName = turnPlayer ? turnPlayer.name : "Opponent";
        status.innerText = `${turnName}'s Turn...`;
        status.style.color = "#c0392b";
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dynamic Font Calculation for smaller cells
    const fontSize = Math.floor(CELL_SIZE * 0.7);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            // RENDER TERRAIN FIRST
            if (localState.terrainMap) {
                const terrain = localState.terrainMap[y][x];
                ctx.fillStyle = terrain.color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

                // Draw symbol slightly transparent in background center
                if (terrain.symbol) {
                    ctx.save();
                    ctx.globalAlpha = 0.3;
                    ctx.font = `${fontSize}px Arial`; // Use dynamic font size
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = "#000";
                    ctx.fillText(terrain.symbol, x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2);
                    ctx.restore();
                }
            }

            const entity = localState.grid[y][x];

            // 1. Unit Background (Owner Color)
            if (entity) {
                const ownerData = localState.players[entity.owner];
                const color = ownerData ? ownerData.color : '#999';
                ctx.globalAlpha = 0.4; // Slightly more opaque than before to pop against terrain
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE + 2, y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
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
                if (selectedCell && isReachable && !entity) {
                    ctx.fillStyle = "rgba(46, 204, 113, 0.4)"; // Darker green for visibility over terrain
                    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                    ctx.beginPath();
                    ctx.arc(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2, 4, 0, Math.PI * 2);
                    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                    ctx.fill();
                }
            }

            // 4. Grid Lines
            ctx.strokeStyle = "rgba(0,0,0,0.1)"; // Lighter grid lines
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            // 5. Entity Icon
            if (entity) {
                if (entity.remainingMovement <= 0 && entity.hasAttacked) {
                    ctx.globalAlpha = 0.5;
                }

                ctx.fillStyle = "#000";
                ctx.font = `${fontSize + 2}px Arial`; // Use dynamic font size
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const icon = icons[entity.type] || '❓';
                const centerX = x * CELL_SIZE + (CELL_SIZE / 2);
                const centerY = y * CELL_SIZE + (CELL_SIZE / 2);

                ctx.fillText(icon, centerX, centerY);

                if (entity.is_commander) {
                    ctx.font = `${fontSize * 0.6}px Arial`;
                    ctx.fillText("👑", centerX, centerY - (fontSize * 0.6));
                }

                if (entity.is_fleeing) {
                    ctx.font = `${fontSize * 0.6}px Arial`;
                    ctx.fillText("🏳️", centerX + (fontSize * 0.5), centerY - (fontSize * 0.5));
                }

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
    const barWidth = CELL_SIZE - 4;
    const barHeight = 2; // Thinner health bar for small cells
    const x = gridX * CELL_SIZE + 2;
    const y = gridY * CELL_SIZE + CELL_SIZE - 4;
    const pct = Math.max(0, current / max);
    ctx.fillStyle = "red";
    ctx.fillRect(x, y, barWidth, barHeight);
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(x, y, barWidth * pct, barHeight);
}