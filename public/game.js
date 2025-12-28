// MAIN CLIENT LOGIC
const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// State
let myId = null;
let localState = null;
let clientUnitStats = {};
let gameConstants = null; // Store received constants
let GRID_SIZE = 50; // Updated by init

// Game Interaction State
let selectedCell = null;
let selectedTemplate = null;
let interactionState = 'NONE';
let validMoves = [];
let validAttackTargets = [];
let cellsInAttackRange = [];

// Initialize Helper Modules
UiManager.init();
// Renderer initialized in socket init

// --- SOCKET LISTENERS ---

socket.on('init', (data) => {
    // Only update myId if the server provides a valid one.
    if (data.myId) {
        myId = data.myId;
    }

    // Check if we are re-initializing (New Game started)
    const isReInit = !!localState;

    localState = data.state;
    clientUnitStats = data.unitStats;
    gameConstants = data.gameConstants;

    // Pass constants to UiManager
    if(UiManager.setConstants) {
        UiManager.setConstants(gameConstants);
    }

    // Update Grid Config
    if (localState.grid) {
        GRID_SIZE = localState.grid.length;
        // Re-initialize Renderer with new grid size
        Renderer.init(ctx, GRID_SIZE, canvas.width);
    }

    // Handle Setup Screen Visibility based on Game State
    if (localState.isGameActive) {
        UiManager.hideSetupScreen();
    } else {
        UiManager.showSetupScreen();
    }

    // Load Images then Render
    Renderer.loadAssets().then(() => {
        // Initial Render after images are loaded
        renderGame();
    });

    UiManager.updateConnectionStatus(myId);
    resetSelection();

    // Render immediately (with fallbacks) in case images take time
    renderGame();

    UiManager.updateLegend(localState, myId, (name) => socket.emit('changeName', name));
    UiManager.updateControls(localState, myId, clientUnitStats);

    // UPDATED: Clear log on restart, always show welcome message (once)
    if (isReInit) {
        UiManager.clearLog();
    }

    UiManager.addLogEntry("Welcome to Chivalry 3!", localState, () => {});
});

socket.on('update', (state) => {
    localState = state;
    // Ensure GRID_SIZE is synced on update as well, just in case
    if (localState.grid && localState.grid.length !== GRID_SIZE) {
        GRID_SIZE = localState.grid.length;
        Renderer.setGridSize(GRID_SIZE, canvas.width);
    }

    if (selectedCell) {
        // Validation: Ensure selected cell is still within bounds
        if (selectedCell.x >= GRID_SIZE || selectedCell.y >= GRID_SIZE) {
            resetSelection();
        } else {
            const entity = localState.grid[selectedCell.y][selectedCell.x];
            if (!entity) {
                resetSelection();
            } else {
                recalculateOptions(entity);
                UiManager.updateUnitInfo(entity, false, null, localState, selectedCell);
            }
        }
    }

    // NEW: Auto-deselect template if we can't afford it anymore (e.g. after buying one)
    if (selectedTemplate && clientUnitStats[selectedTemplate] && localState.players[myId]) {
        if (localState.players[myId].gold < clientUnitStats[selectedTemplate].cost) {
            resetSelection();
        }
    }

    renderGame();
    UiManager.updateStatus(localState, myId);
    UiManager.updateLegend(localState, myId, (name) => socket.emit('changeName', name));
    UiManager.updateControls(localState, myId, clientUnitStats);
});

socket.on('gameLog', (data) => {
    UiManager.addLogEntry(data.message, localState, (x,y) => selectUnitFromLog(x,y));
});

socket.on('combatResults', (data) => {
    if (data.logs) {
        data.logs.forEach(msg => UiManager.addLogEntry(msg, localState, (x,y) => selectUnitFromLog(x,y)));
    }
    if (data.events) {
        data.events.forEach(ev => {
            if (ev.type === 'damage' || ev.type === 'death') {
                UiManager.showFloatingText(ev.x, ev.y, ev.value, ev.color || 'red', Renderer.CELL_SIZE);
            }
        });
    }
});

// --- RENDER LOOP ---
function renderGame() {
    // Pass gameConstants to Renderer so it can draw aura ranges
    Renderer.draw(localState, myId, selectedCell, interactionState, validMoves, validAttackTargets, cellsInAttackRange, gameConstants);
}

// --- LOGIC HELPER ---
function selectUnitFromLog(x, y) {
    if (!localState) return;
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    const entity = localState.grid[y][x];
    if (!entity) return;

    resetSelection();
    selectedCell = { x, y };
    interactionState = 'SELECTED';

    UiManager.updateUnitInfo(entity, false, null, localState, selectedCell);

    if (entity && !entity.is_fleeing) {
        recalculateOptions(entity);
    }
    renderGame();
}

function resetSelection() {
    selectedCell = null;
    selectedTemplate = null;
    interactionState = 'NONE';
    validMoves = [];
    validAttackTargets = [];
    cellsInAttackRange = [];
    UiManager.hideContextMenu();
    document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
    UiManager.updateUnitInfo(null, false);
}

// Client Side Pathfinding/LoS for UI
function recalculateOptions(entity) {
    if (entity.is_fleeing) {
        validMoves = []; validAttackTargets = []; cellsInAttackRange = [];
        return;
    }

    // Determine stats to use for visualization
    let moveDist = entity.remainingMovement;
    let canAttack = !entity.hasAttacked;

    // Show full potential if we are not the active player controlling this unit.
    const isCommanding = (entity.owner === myId && localState.turn === myId);

    if (!isCommanding) {
        moveDist = entity.speed;
        canAttack = true;
    }

    validMoves = getReachableCells(selectedCell, moveDist, localState.grid, localState.terrainMap);

    validAttackTargets = [];
    cellsInAttackRange = [];

    if (canAttack) {
        let range = entity.range;
        const myTerrain = localState.terrainMap[selectedCell.y][selectedCell.x];
        const rangeBonus = gameConstants ? gameConstants.BONUS_HIGH_GROUND_RANGE : 1;

        for (let y = 0; y < GRID_SIZE; y++) {
            for (let x = 0; x < GRID_SIZE; x++) {
                const dist = Math.abs(selectedCell.x - x) + Math.abs(selectedCell.y - y);

                // Dynamic Range Bonus Check
                let effectiveRange = range;
                if (entity.is_ranged && myTerrain.height > localState.terrainMap[y][x].height) {
                    effectiveRange += rangeBonus;
                }

                let hasLoS = true;
                if (entity.is_ranged) {
                    hasLoS = clientHasLineOfSight(selectedCell, {x, y});
                }

                const isValidAngle = clientIsValidAttackDirection(entity, selectedCell, {x, y});

                if (dist <= effectiveRange && dist > 0 && hasLoS && isValidAngle) {
                    cellsInAttackRange.push({x, y});
                    const targetEntity = localState.grid[y][x];

                    if (entity.is_ranged) {
                        // Ranged units can target empty cells or enemies
                        if (!targetEntity || targetEntity.owner !== entity.owner) {
                            validAttackTargets.push({x, y});
                        }
                    } else {
                        // Melee units must target an enemy
                        if (targetEntity && targetEntity.owner !== entity.owner) {
                            validAttackTargets.push({x, y});
                        }
                    }
                }
            }
        }
    }
}

function clientIsValidAttackDirection(unit, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    // 0: Up, 2: Right, 4: Down, 6: Left

    if (unit.is_ranged) {
        // 90 degree cone
        if (unit.facing_direction === 0) return dy < 0 && Math.abs(dx) <= Math.abs(dy);
        if (unit.facing_direction === 2) return dx > 0 && Math.abs(dy) <= Math.abs(dx);
        if (unit.facing_direction === 4) return dy > 0 && Math.abs(dx) <= Math.abs(dy);
        if (unit.facing_direction === 6) return dx < 0 && Math.abs(dy) <= Math.abs(dx);
    } else {
        // Front only (linear)
        if (unit.facing_direction === 0) return dx === 0 && dy < 0;
        if (unit.facing_direction === 2) return dy === 0 && dx > 0;
        if (unit.facing_direction === 4) return dx === 0 && dy > 0;
        if (unit.facing_direction === 6) return dy === 0 && dx < 0;
    }
    return false;
}

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

function getReachableCells(start, maxDist, grid, terrainMap) {
    if (maxDist <= 0) return [];
    let costs = {};
    let queue = [{x: start.x, y: start.y, cost: 0}];
    costs[`${start.x},${start.y}`] = 0;
    let reachable = [];

    // Constants fallback
    const heightDiffLimit = (gameConstants) ? gameConstants.HEIGHT_DIFFERENCE_LIMIT : 1;
    const heightPenalty = (gameConstants) ? gameConstants.MOVEMENT_COST_HEIGHT_PENALTY : 1;

    while(queue.length > 0) {
        queue.sort((a,b) => a.cost - b.cost);
        let current = queue.shift();

        if (current.x !== start.x || current.y !== start.y) {
            if (!reachable.some(r => r.x === current.x && r.y === current.y)) {
                reachable.push({x: current.x, y: current.y});
            }
        }

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const currentTerrain = terrainMap[current.y][current.x];

        for (const [dx, dy] of dirs) {
            const nx = current.x + dx;
            const ny = current.y + dy;
            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                const key = `${nx},${ny}`;
                const t = terrainMap[ny][nx];

                // --- HEIGHT CHECK ---
                // Block if height difference is too great
                const hDiff = Math.abs(t.height - currentTerrain.height);
                if (hDiff > heightDiffLimit) continue;

                // Unit Collision
                if (grid[ny][nx]) continue;

                // --- COST CALCULATION ---
                let moveCost = t.cost;
                // Add penalty for moving UP
                if (t.height > currentTerrain.height) {
                    moveCost += (t.height - currentTerrain.height) * heightPenalty;
                }

                const newCost = current.cost + moveCost;
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

// --- INPUT LISTENERS ---

document.getElementById('end-turn-btn').addEventListener('click', () => {
    socket.emit('endTurn');
    resetSelection();
});

// Setup Screen Button
document.getElementById('btn-start-game').addEventListener('click', () => {
    const settings = UiManager.getSetupSettings();
    socket.emit('startGame', settings);
});

// Template Listeners
document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        if (localState.turn !== myId) return;
        if (el.classList.contains('disabled')) return;
        resetSelection();
        el.classList.add('selected-template');
        selectedTemplate = el.dataset.type;
        if (clientUnitStats[selectedTemplate]) {
            UiManager.updateUnitInfo(clientUnitStats[selectedTemplate], true, selectedTemplate);
        }
        renderGame();
    });
});

// Canvas Click
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / Renderer.CELL_SIZE);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / Renderer.CELL_SIZE);

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) {
        resetSelection();
        renderGame();
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
        renderGame();
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
        renderGame();
        return;
    }

    if (interactionState === 'MENU') {
        UiManager.hideContextMenu();
        interactionState = 'SELECTED';
        if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
            renderGame();
            return;
        }
    }

    if (clickedEntity && selectedCell && selectedCell.x === x && selectedCell.y === y) {
        if (clickedEntity.owner === myId && localState.turn === myId) {
            if (clickedEntity.is_fleeing) return;
            UiManager.showContextMenu(e.clientX, e.clientY, clickedEntity, selectedCell, Renderer.CELL_SIZE);
            interactionState = 'MENU';
        }
        renderGame();
        return;
    }

    if (clickedEntity) {
        resetSelection();
        selectedCell = { x, y };
        interactionState = 'SELECTED';
        UiManager.updateUnitInfo(clickedEntity, false, null, localState, selectedCell);

        // Calculate options for any unit (including enemies) to show ranges
        if (!clickedEntity.is_fleeing) recalculateOptions(clickedEntity);
    }
    else if (selectedTemplate && !clickedEntity) {
        if (localState.turn === myId) {
            socket.emit('spawnEntity', { x, y, type: selectedTemplate });
            // Modified: Removed resetSelection() here to allow buying multiple units in sequence
        }
    }
    else if (selectedCell && !clickedEntity) {
        const isValid = validMoves.some(m => m.x === x && m.y === y);

        // Ensure we only emit move command if we own the unit AND it's our turn
        const selectedUnit = localState.grid[selectedCell.y][selectedCell.x];
        if (isValid && selectedUnit && selectedUnit.owner === myId && localState.turn === myId) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
            interactionState = 'SELECTED';
        } else {
            resetSelection();
        }
    }
    else {
        resetSelection();
    }
    renderGame();
});

// Canvas Hover for Cell Info
canvas.addEventListener('mousemove', (e) => {
    if (!localState || !Renderer.CELL_SIZE) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / Renderer.CELL_SIZE);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / Renderer.CELL_SIZE);

    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && localState.terrainMap) {
        const terrain = localState.terrainMap[y][x];
        UiManager.updateCellInfo(terrain, x, y);
    } else {
        UiManager.updateCellInfo(null);
    }
});

canvas.addEventListener('mouseleave', () => {
    UiManager.updateCellInfo(null);
});

// Menu Buttons
const btnAttack = document.getElementById('btn-attack');
const btnRotate = document.getElementById('btn-rotate');
const btnDeselect = document.getElementById('btn-deselect');

btnAttack.addEventListener('click', () => { interactionState = 'ATTACK_TARGETING'; UiManager.hideContextMenu(); renderGame(); });
btnRotate.addEventListener('click', () => { interactionState = 'ROTATING'; UiManager.hideContextMenu(); renderGame(); });
btnDeselect.addEventListener('click', () => { resetSelection(); renderGame(); });

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        resetSelection();
        renderGame();
    }
});