const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats');
const constants = require('./constants');
const mapGenerator = require('./mapGenerator');
const gameLogic = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve files from 'public' folder
app.use(express.static('public'));
// Serve files from 'images' folder at the '/images' route
app.use('/images', express.static('images'));

let gameState = {
    grid: null,
    terrainMap: null,
    players: {},
    turn: null,
    turnCount: 1, // Global turn counter
    isGameActive: false, // Track if the game is in Lobby or Playing state
    matchSettings: null, // Store slot config to handle late joins
    slotData: {} // Store data for disconnected slots (gold, etc.)
};

// Start initial game with defaults but keep it inactive (Lobby mode)
startNewGame({
    gridSize: constants.GRID_SIZE,
    slots: [
        { index: 0, type: 'open', gold: 2000 }, // Default Host Slot
        { index: 1, type: 'ai', gold: 2000, difficulty: 'normal' },
        { index: 2, type: 'closed', gold: 2000 },
        { index: 3, type: 'closed', gold: 2000 }
    ]
}, null);

// Force inactive state after initial setup
gameState.isGameActive = false;

function startNewGame(settings, hostId) {
    // 1. Update Constants (Runtime Override)
    if(settings.gridSize) constants.GRID_SIZE = parseInt(settings.gridSize);

    // Store settings for later use (Open slot filling)
    gameState.matchSettings = settings;
    gameState.slotData = {}; // Reset slot data on new game

    // 2. Reset Grid & Terrain
    gameState.grid = Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null));

    // CRITICAL: Initialize with COPIES of the object, not the same reference
    gameState.terrainMap = Array(constants.GRID_SIZE).fill(null).map(() =>
        Array(constants.GRID_SIZE).fill(null).map(() => ({...constants.TERRAIN.PLAINS}))
    );

    // 3. Regenerate Map
    mapGenerator.generateMap(gameState);

    // 4. Handle Players (Complete Reset based on Slots)
    // Gather all currently connected sockets
    let connectedSockets = Object.keys(gameState.players).filter(id => !gameState.players[id].isAI);
    // If this is a restart, ensure the hostId (if provided) is in the list
    if(hostId && !connectedSockets.includes(hostId)) connectedSockets.push(hostId);

    gameState.players = {}; // Clear all previous player state

    const slots = settings.slots || [];
    let usedSockets = []; // Track sockets assigned to specific 'me' slots

    // Pass 1: Assign 'Me' slots
    slots.forEach(slot => {
        if(slot.type === 'me' && hostId) {
            createPlayer(hostId, slot.index, slot.gold, false, null);
            usedSockets.push(hostId);
        }
    });

    // Pass 2: Assign AI and Open slots
    slots.forEach(slot => {
        // Skip if already assigned (e.g., 'me' slot)
        if (gameState.players[getPlayerIdForIndex(slot.index, hostId)]) return;

        if (slot.type === 'ai') {
            const aiId = `ai_${slot.index}`;
            createPlayer(aiId, slot.index, slot.gold, true, slot.difficulty);
        }
        else if (slot.type === 'open') {
            // Find a connected human who hasn't been assigned yet
            const availableSocket = connectedSockets.find(sid => !usedSockets.includes(sid));

            if (availableSocket) {
                createPlayer(availableSocket, slot.index, slot.gold, false, null);
                usedSockets.push(availableSocket);
            }
        }
        // 'closed' slots are simply ignored, so no player is created at that index.
    });

    // Pass 3: Assign remaining connected sockets as Observers
    connectedSockets.forEach(sid => {
        if (!usedSockets.includes(sid)) {
            createObserver(sid);
        }
    });

    // 5. Set Turn
    const allIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver);
    gameState.turn = allIds.length > 0 ? allIds[0] : null;
    gameState.turnCount = 1;

    // 6. Set Game Active
    gameState.isGameActive = true;

    // 7. Broadcast new state
    io.emit('init', {
        state: gameState,
        myId: null, // Client ignores this in general update, but init handler needs structure
        unitStats: unitStats,
        gameConstants: constants
    });

    io.emit('gameLog', { message: "--- NEW GAME STARTED ---" });
}

// Helper to determine ID
function getPlayerIdForIndex(index, hostId) {
    const pIds = Object.keys(gameState.players);
    for(let id of pIds) {
        if (gameState.players[id].slotIndex === index) return id;
    }
    return null;
}

function createPlayer(id, index, gold, isAI, difficulty) {
    const playerColor = constants.PLAYER_COLORS[index % constants.PLAYER_COLORS.length];
    const playerSymbol = index === 0 ? 'X' : (index === 1 ? 'O' : (index === 2 ? 'Y' : 'Z'));
    const baseArea = getBaseArea(index);
    const defaultName = isAI ? `Bot ${index+1}` : `Player ${index+1}`;

    // CHECK FOR PREVIOUS STATE (RECONNECTION)
    let finalGold = gold;
    if (gameState.slotData && gameState.slotData[index]) {
        finalGold = gameState.slotData[index].gold;
        // Reclaim units
        const placeholderOwner = `disconnected_slot_${index}`;
        for(let r=0; r<constants.GRID_SIZE; r++) {
            for(let c=0; c<constants.GRID_SIZE; c++) {
                if(gameState.grid[r][c] && gameState.grid[r][c].owner === placeholderOwner) {
                    gameState.grid[r][c].owner = id;
                }
            }
        }
        // Clear slot data after claiming (optional, but good for cleanliness)
        delete gameState.slotData[index];
    }

    gameState.players[id] = {
        symbol: playerSymbol,
        color: playerColor,
        id: id,
        name: defaultName,
        gold: finalGold,
        baseArea: baseArea,
        isAI: isAI,
        difficulty: difficulty || 'normal',
        slotIndex: index, // Track which slot they occupy
        isObserver: false
    };
}

function createObserver(id) {
    const observerCount = Object.values(gameState.players).filter(p => p.isObserver).length;
    gameState.players[id] = {
        id: id,
        name: `Observer ${observerCount + 1}`,
        color: '#95a5a6', // Grey
        isObserver: true,
        gold: 0,
        isAI: false
        // No baseArea, no slotIndex
    };
}

function getBaseArea(playerIndex) {
    const G = constants.GRID_SIZE;
    const dimLong = Math.floor(G / 2);
    const dimShort = Math.floor(G / 20);
    const centerOffset = Math.floor((G - dimLong) / 2);

    if (playerIndex === 0) return { x: centerOffset, y: 0, width: dimLong, height: dimShort }; // Top
    if (playerIndex === 1) return { x: centerOffset, y: G - dimShort, width: dimLong, height: dimShort }; // Bottom
    if (playerIndex === 2) return { x: 0, y: centerOffset, width: dimShort, height: dimLong }; // Left
    if (playerIndex === 3) return { x: G - dimShort, y: centerOffset, width: dimShort, height: dimLong }; // Right
    return null;
}

function addPlayerToGame(socketId) {
    // Used when a NEW player connects.
    // Check match settings to see if there is an 'open' slot that is currently empty.

    if (!gameState.matchSettings || !gameState.matchSettings.slots) {
        // Fallback for initial load
        return;
    }

    const slots = gameState.matchSettings.slots;

    // Find first 'open' slot that doesn't have a player in `gameState.players`
    let targetSlot = null;

    for(let slot of slots) {
        if (slot.type === 'open') {
            // Check if occupied
            const isOccupied = Object.values(gameState.players).some(p => p.slotIndex === slot.index);
            if (!isOccupied) {
                targetSlot = slot;
                break;
            }
        }
    }

    if (targetSlot) {
        createPlayer(socketId, targetSlot.index, targetSlot.gold, false, null);
    } else {
        // No open slots? Add as Observer
        createObserver(socketId);
    }
}

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // Try to join existing game
    addPlayerToGame(socket.id);

    socket.emit('init', {
        state: gameState,
        myId: socket.id,
        unitStats: unitStats,
        gameConstants: constants
    });

    io.emit('update', gameState);

    socket.on('startGame', (settings) => {
        console.log("Starting new game with settings:", settings);
        startNewGame(settings, socket.id); // Pass socket.id as Host ID
    });

    socket.on('changeName', (newName) => {
        const player = gameState.players[socket.id];
        if (player) {
            const cleanName = newName.trim().substring(0, 12) || player.name;
            player.name = cleanName;
            io.emit('update', gameState);
        }
    });

    socket.on('spawnEntity', ({ x, y, type }) => {
        const player = gameState.players[socket.id];
        if (!player || player.isObserver) return; // Observers cannot spawn
        if (socket.id !== gameState.turn) return;

        // Check if spawn is within player's base area
        if (player.baseArea) {
            if (x < player.baseArea.x || x >= player.baseArea.x + player.baseArea.width ||
                y < player.baseArea.y || y >= player.baseArea.y + player.baseArea.height) {
                // Return if attempting to spawn outside base
                return;
            }
        } else {
            return;
        }

        const terrain = gameState.terrainMap[y][x];

        if (terrain.id === 'water' || terrain.id === 'wall') return;

        if (!gameState.grid[y][x]) {
            const baseStats = unitStats[type];
            if (!baseStats) return;

            if (player.gold < baseStats.cost) return;

            let hasUnits = false;
            for(let r=0; r<constants.GRID_SIZE; r++) {
                for(let c=0; c<constants.GRID_SIZE; c++) {
                    if (gameState.grid[r][c] && gameState.grid[r][c].owner === socket.id) {
                        hasUnits = true;
                        break;
                    }
                }
                if(hasUnits) break;
            }

            const isCommander = !hasUnits;
            player.gold -= baseStats.cost;

            gameState.grid[y][x] = {
                type: type,
                owner: socket.id,
                symbol: gameState.players[socket.id].symbol,
                remainingMovement: 0,
                hasAttacked: true,
                ...baseStats,
                // CRITICAL: Create a fresh copy of the array so this unit has its own abilities list.
                // Otherwise, adding "Commander's Will" to this unit would add it to ALL units of this type.
                special_abilities: [...(baseStats.special_abilities || [])],
                current_health: baseStats.max_health,
                raw_morale: baseStats.initial_morale,
                current_morale: baseStats.initial_morale,
                facing_direction: 0,
                is_commander: isCommander,
                is_fleeing: false,
                morale_breakdown: []
            };

            // Send player.id instead of player.name so client can update dynamic names
            let msg = `{p:${player.id}} recruited a {u:${type}:${x}:${y}:${player.id}}`;
            if (isCommander) msg += " as their Commander!";
            else msg += ".";
            io.emit('gameLog', { message: msg });

            gameLogic.updateAllUnitsMorale(gameState);
            io.emit('update', gameState);
        }
    });

    socket.on('moveEntity', ({ from, to }) => {
        if (socket.id !== gameState.turn) return;

        const entity = gameState.grid[from.y][from.x];
        const targetCell = gameState.grid[to.y][to.x];

        if (entity && entity.owner === socket.id && !targetCell) {
            if (entity.is_fleeing) return;

            const pathCost = gameLogic.getPathCost(from, to, gameState.grid, gameState.terrainMap, entity.remainingMovement);

            if (pathCost > -1 && entity.remainingMovement >= pathCost) {
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                if (Math.abs(dy) > Math.abs(dx)) {
                    entity.facing_direction = dy > 0 ? 4 : 0;
                } else {
                    entity.facing_direction = dx > 0 ? 2 : 6;
                }

                entity.remainingMovement -= pathCost;
                gameState.grid[to.y][to.x] = entity;
                gameState.grid[from.y][from.x] = null;

                gameLogic.updateAllUnitsMorale(gameState);
                io.emit('update', gameState);
            }
        }
    });

    socket.on('rotateEntity', ({ x, y, direction }) => {
        if (socket.id !== gameState.turn) return;
        const entity = gameState.grid[y][x];
        if (entity && entity.owner === socket.id && entity.remainingMovement >= 1) {
            if (entity.is_fleeing) return;

            entity.facing_direction = direction;
            entity.remainingMovement -= 1;

            gameLogic.updateAllUnitsMorale(gameState);
            io.emit('update', gameState);
        }
    });

    socket.on('attackEntity', ({ attackerPos, targetPos }) => {
        if (socket.id !== gameState.turn) return;

        const attacker = gameState.grid[attackerPos.y][attackerPos.x];
        const target = gameState.grid[targetPos.y][targetPos.x];

        if (attacker && attacker.is_fleeing) return;

        const combatResults = { events: [], logs: [] };

        // Validate Attack
        // 1. Attacker must exist, belong to player, and have attack available
        if (!attacker || attacker.owner !== socket.id || attacker.hasAttacked) return;

        // 2. Target validation
        if (target) {
            // Cannot attack own units
            if (target.owner === socket.id) return;
        } else {
            // Only ranged units can attack empty cells
            if (!attacker.is_ranged) return;
        }

        const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);

        const attackerTerrain = gameState.terrainMap[attackerPos.y][attackerPos.x];
        const targetTerrain = gameState.terrainMap[targetPos.y][targetPos.x];
        let effectiveRange = attacker.range;

        // DYNAMIC HIGH GROUND RANGE BONUS
        // Checks if attacker is higher than the target location
        if (attacker.is_ranged && attackerTerrain.height > targetTerrain.height) {
            effectiveRange += constants.BONUS_HIGH_GROUND_RANGE;
        }

        if (dist <= effectiveRange) {
            if (attacker.is_ranged && !gameLogic.hasLineOfSight(attackerPos, targetPos, gameState.terrainMap)) {
                return;
            }

            if (!gameLogic.isValidAttackAngle(attacker, attackerPos, targetPos)) {
                return;
            }

            if (target) {
                combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} attacks {u:${target.type}:${targetPos.x}:${targetPos.y}:${target.owner}}!`);
            } else {
                combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} fires at (${targetPos.x}, ${targetPos.y})!`);
            }

            gameLogic.performCombat(attacker, attackerPos, target, targetPos, false, combatResults, gameState);

            // LOGIC CHANGE: Check for "Momentum" rule
            // If Melee attack AND target destroyed, allow using remaining movement.
            const targetDestroyed = target && !gameState.grid[targetPos.y][targetPos.x];
            const isMelee = !attacker.is_ranged;

            attacker.hasAttacked = true;

            if (isMelee && targetDestroyed) {
                // Keep existing remainingMovement
                // If it was 0, it stays 0. If they had moves left, they keep them.
            } else {
                // Standard rule: Attacking ends movement
                attacker.remainingMovement = 0;
            }

            gameLogic.updateAllUnitsMorale(gameState);
            io.emit('update', gameState);
            io.emit('combatResults', combatResults);
        }
    });

    socket.on('endTurn', () => {
        if (socket.id === gameState.turn) {
            endTurn();
        }
    });

    function endTurn() {
        // Find current player in the rotation
        const activeIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver);
        // Note: activeIds order might not match slot order if object keys are unordered,
        // but generally V8 keeps insertion order for strings.
        // For robustness, sort by slotIndex
        activeIds.sort((a,b) => gameState.players[a].slotIndex - gameState.players[b].slotIndex);

        const currentIndex = activeIds.indexOf(gameState.turn);

        // Reset current player units
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = 0; u.hasAttacked = true; });

        // Calculate next index
        const nextIndex = (currentIndex + 1) % activeIds.length;
        gameState.turn = activeIds[nextIndex];

        // Increment global turn counter only when the cycle wraps around to the first player
        if (nextIndex === 0) {
            gameState.turnCount++;
        }

        // Reset next player units
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });

        io.emit('gameLog', { message: `Turn changed to {p:${gameState.turn}}.` });

        gameLogic.handleMoralePhase(gameState.turn, gameState, io);
        io.emit('update', gameState);
    }

    function modifyUnitsForPlayer(playerId, callback) {
        for (let y = 0; y < constants.GRID_SIZE; y++) {
            for (let x = 0; x < constants.GRID_SIZE; x++) {
                const entity = gameState.grid[y][x];
                if (entity && entity.owner === playerId) {
                    callback(entity);
                }
            }
        }
    }

    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];

        // SAVE STATE before deleting
        if (player && !player.isObserver) {
            gameState.slotData[player.slotIndex] = {
                gold: player.gold,
                // We could save name/color if we wanted to enforce it, but new player usually wants their own identity
            };

            // Mark units on grid as belonging to this slot (placeholder owner)
            const placeholderOwner = `disconnected_slot_${player.slotIndex}`;
            for (let y = 0; y < constants.GRID_SIZE; y++) {
                for (let x = 0; x < constants.GRID_SIZE; x++) {
                    if(gameState.grid[y][x] && gameState.grid[y][x].owner === socket.id){
                        gameState.grid[y][x].owner = placeholderOwner;
                    }
                }
            }
        }

        delete gameState.players[socket.id];

        // If it was the current turn player, pass turn
        if (player && !player.isObserver && gameState.turn === socket.id) {
            const activeIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver);
            if (activeIds.length > 0) {
                // Simple logic: pick the first one available
                // A more robust logic would try to find the "next" slot, but since the array changed, 0 is safe.
                gameState.turn = activeIds[0];
                modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });
                io.emit('gameLog', { message: `Player disconnected. Turn passed to {p:${gameState.turn}}.` });
            } else {
                gameState.turn = null;
            }
        }
        io.emit('update', gameState);
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));