// MAIN CLIENT LOGIC
const socket = io();
const canvas = document.getElementById('gameCanvas');
const minimapCanvas = document.getElementById('minimap');
const ctx = canvas.getContext('2d');

// State
let myId = null;
let localState = null;
let clientUnitStats = {};
let gameConstants = null;
let GRID_SIZE = 50;

// Game Interaction State
let selectedCell = null;
let selectedTemplate = null;
let interactionState = 'NONE';
let validMoves = [];
let validAttackTargets = [];
let cellsInAttackRange = [];

// Dragging State
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let hasDragged = false; // Flag to prevent click event if user was dragging

UiManager.init();

// --- SOCKET LISTENERS ---

socket.on('init', (data) => {
    if (data.myId) {
        myId = data.myId;
    }
    const isReInit = !!localState;

    localState = data.state;
    clientUnitStats = data.unitStats;
    gameConstants = data.gameConstants;

    if(UiManager.setConstants) {
        UiManager.setConstants(gameConstants);
    }

    if (localState.grid) {
        GRID_SIZE = localState.grid.length;
        Renderer.init(ctx, GRID_SIZE, canvas.width, minimapCanvas);
    }

    if (localState.isGameActive) {
        UiManager.hideSetupScreen();
    } else {
        UiManager.showSetupScreen();
    }

    Renderer.loadAssets().then(() => {
        renderGame();
    });

    UiManager.updateConnectionStatus(myId);
    resetSelection();
    renderGame();

    UiManager.updateLegend(localState, myId, (name) => socket.emit('changeName', name));
    UiManager.updateControls(localState, myId, clientUnitStats);

    if (isReInit) {
        UiManager.clearLog();
    }
    UiManager.addLogEntry("Welcome to Chivalry 3!", localState, () => {});
});

socket.on('update', (state) => {
    localState = state;
    if (localState.grid && localState.grid.length !== GRID_SIZE) {
        GRID_SIZE = localState.grid.length;
        Renderer.setGridSize(GRID_SIZE, canvas.width);
    }

    if (selectedCell) {
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
                UiManager.showFloatingText(ev.x, ev.y, ev.value, ev.color || 'red', Renderer.CELL_SIZE * Renderer.getZoom());
            }
        });
    }
});

socket.on('saveGameData', (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chivalry_save_${new Date().toISOString().slice(0,19).replace(/:/g,"-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    UiManager.addLogEntry("Game saved successfully.", localState, () => {});
});

// --- RENDER LOOP ---
function renderGame() {
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

    let moveDist = entity.remainingMovement;
    let canAttack = !entity.hasAttacked;
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
                        if (!targetEntity || targetEntity.owner !== entity.owner) {
                            validAttackTargets.push({x, y});
                        }
                    } else {
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
    if (unit.is_ranged) {
        if (unit.facing_direction === 0) return dy < 0 && Math.abs(dx) <= Math.abs(dy);
        if (unit.facing_direction === 2) return dx > 0 && Math.abs(dy) <= Math.abs(dx);
        if (unit.facing_direction === 4) return dy > 0 && Math.abs(dx) <= Math.abs(dy);
        if (unit.facing_direction === 6) return dx < 0 && Math.abs(dy) <= Math.abs(dx);
    } else {
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

                const hDiff = Math.abs(t.height - currentTerrain.height);
                if (hDiff > heightDiffLimit) continue;
                if (grid[ny][nx]) continue;

                let moveCost = t.cost;
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

// ZOOM LISTENER (Mouse Wheel)
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let mouseX = null;
    let mouseY = null;

    if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
        mouseX = (e.clientX - rect.left) * scaleX;
        mouseY = (e.clientY - rect.top) * scaleY;
    }

    const delta = Math.sign(e.deltaY) * -0.1;
    Renderer.zoomAt(delta, mouseX, mouseY);
    renderGame();
});

// DRAGGING LOGIC (Mouse Down/Move/Up on Canvas)
canvas.addEventListener('mousedown', (e) => {
    // Only drag if zoomed in
    if (Renderer.getZoom() > 1.0) {
        isDragging = true;
        hasDragged = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
    }
});

canvas.addEventListener('mousemove', (e) => {
    if (!localState || !Renderer.CELL_SIZE) return;

    // Handle Hover Info
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;

    // Handle Dragging
    if (isDragging) {
        const dx = (e.clientX - dragStartX) * scaleX;
        const dy = (e.clientY - dragStartY) * scaleY;

        // Threshold to distinguish click from drag
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged = true;

        if (hasDragged) {
            Renderer.pan(dx, dy);
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            renderGame();
            // Don't update cell info while dragging for performance/clarity
            return;
        }
    }

    // Normal Hover
    const x = Math.floor((screenX - Renderer.panX) / (Renderer.CELL_SIZE * Renderer.zoom));
    const y = Math.floor((screenY - Renderer.panY) / (Renderer.CELL_SIZE * Renderer.zoom));

    if (x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE && localState.terrainMap) {
        const terrain = localState.terrainMap[y][x];
        // Pass pageX/pageY for tooltip positioning
        UiManager.updateCellInfo(terrain, x, y, e.pageX, e.pageY);
    } else {
        UiManager.updateCellInfo(null);
    }
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    UiManager.updateCellInfo(null);
});

// MINIMAP NAVIGATION
function handleMinimapInput(e) {
    // Stop propagation so we don't click the canvas underneath
    e.stopPropagation();

    const rect = minimapCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Normalize 0-1
    const nX = x / minimapCanvas.width;
    const nY = y / minimapCanvas.height;

    Renderer.centerOn(nX, nY);
    renderGame();
}

// Support clicking and dragging on minimap
let isMinimapDragging = false;

minimapCanvas.addEventListener('mousedown', (e) => {
    isMinimapDragging = true;
    handleMinimapInput(e);
});

minimapCanvas.addEventListener('mousemove', (e) => {
    if (isMinimapDragging) {
        handleMinimapInput(e);
    }
});

minimapCanvas.addEventListener('mouseup', () => isMinimapDragging = false);
minimapCanvas.addEventListener('mouseleave', () => isMinimapDragging = false);


document.getElementById('end-turn-btn').addEventListener('click', () => {
    socket.emit('endTurn');
    resetSelection();
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    const settings = UiManager.getSetupSettings();
    socket.emit('startGame', settings);
});

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

// --- SAVE / LOAD BUTTONS ---

document.getElementById('btn-save-game').addEventListener('click', () => {
    if (!localState || !localState.isGameActive) {
        alert("Game not active. Start a game to save.");
        return;
    }
    socket.emit('requestSave');
});

const fileInput = document.getElementById('file-input-load');
document.getElementById('btn-load-game').addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm("Loading a game will overwrite the current session. Continue?")) {
                socket.emit('loadGame', data);
            }
        } catch (err) {
            alert("Invalid save file format.");
        }
    };
    reader.readAsText(file);
    fileInput.value = ''; // Reset input so same file can be selected again
});

// ---------------------------

// Right-click (Context Menu) Logic
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    // Prevent action if we were dragging/panning
    if (hasDragged) {
        hasDragged = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;

    const x = Math.floor((screenX - Renderer.panX) / (Renderer.CELL_SIZE * Renderer.zoom));
    const y = Math.floor((screenY - Renderer.panY) / (Renderer.CELL_SIZE * Renderer.zoom));

    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    if (!localState) return;

    const clickedEntity = localState.grid[y][x];

    if (clickedEntity) {
        // 1. Select the unit (Clears previous selection first)
        resetSelection();
        selectedCell = { x, y };
        interactionState = 'SELECTED';

        UiManager.updateUnitInfo(clickedEntity, false, null, localState, selectedCell);

        if (!clickedEntity.is_fleeing) {
            recalculateOptions(clickedEntity);
        }

        // 2. Open Menu immediately if it's my unit and my turn
        if (clickedEntity.owner === myId && localState.turn === myId && !clickedEntity.is_fleeing) {
            UiManager.showContextMenu(e.clientX, e.clientY, clickedEntity, selectedCell, Renderer.CELL_SIZE * Renderer.zoom);
            interactionState = 'MENU';
        }

        renderGame();
    }
});

// Canvas Click
canvas.addEventListener('click', (e) => {
    // Abort if this was a drag operation
    if (hasDragged) {
        hasDragged = false;
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;

    const x = Math.floor((screenX - Renderer.panX) / (Renderer.CELL_SIZE * Renderer.zoom));
    const y = Math.floor((screenY - Renderer.panY) / (Renderer.CELL_SIZE * Renderer.zoom));

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
            UiManager.showContextMenu(e.clientX, e.clientY, clickedEntity, selectedCell, Renderer.CELL_SIZE * Renderer.zoom);
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
        if (!clickedEntity.is_fleeing) recalculateOptions(clickedEntity);
    }
    else if (selectedTemplate && !clickedEntity) {
        if (localState.turn === myId) {
            socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        }
    }
    else if (selectedCell && !clickedEntity) {
        const isValid = validMoves.some(m => m.x === x && m.y === y);
        const selectedUnit = localState.grid[selectedCell.y][selectedCell.x];
        if (isValid && selectedUnit && selectedUnit.owner === myId && localState.turn === myId) {
            socket.emit('moveEntity', { from: selectedCell, to: { x, y } });

            // Optimistically update selection to destination
            selectedCell = { x, y };
            interactionState = 'SELECTED';
            // Clear valid moves until server update arrives to prevent race conditions
            validMoves = [];
            validAttackTargets = [];
            cellsInAttackRange = [];
            // ---------------------

        } else {
            resetSelection();
        }
    }
    else {
        resetSelection();
    }
    renderGame();
});

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