const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats');
const constants = require('./constants');
const mapGenerator = require('./mapGenerator');
const gameLogic = require('./gameLogic');
const aiLogic = require('./aiLogic');

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
    slotData: {}, // Store data for disconnected slots (gold, name, units ownership)
    winner: null // Track the winner ID
};

// Start initial game with defaults but keep it inactive (Lobby mode)
startNewGame({
    gridSize: constants.GRID_SIZE,
    slots: [
        { index: 0, type: 'open', gold: constants.DEFAULT_STARTING_GOLD },
        { index: 1, type: 'ai', gold: constants.DEFAULT_STARTING_GOLD, difficulty: 'normal' },
        { index: 2, type: 'closed', gold: constants.DEFAULT_STARTING_GOLD },
        { index: 3, type: 'closed', gold: constants.DEFAULT_STARTING_GOLD }
    ]
}, null);

// Force inactive state after initial setup
gameState.isGameActive = false;

function startNewGame(settings, hostId) {
    // 1. Determine Grid Size & Map Source
    if (settings.mapData && settings.mapData.gridSize) {
        let size = parseInt(settings.mapData.gridSize);
        size = Math.max(constants.MIN_GRID_SIZE, Math.min(constants.MAX_GRID_SIZE, size));
        constants.GRID_SIZE = size;

        gameState.grid = Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null));
        gameState.terrainMap = settings.mapData.terrainMap;
    } else {
        if(settings.gridSize) {
            let size = parseInt(settings.gridSize);
            size = Math.max(constants.MIN_GRID_SIZE, Math.min(constants.MAX_GRID_SIZE, size));
            constants.GRID_SIZE = size;
        }
        gameState.grid = Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null));
        gameState.terrainMap = Array(constants.GRID_SIZE).fill(null).map(() =>
            Array(constants.GRID_SIZE).fill(null).map(() => ({...constants.TERRAIN.PLAINS}))
        );
        mapGenerator.generateMap(gameState);
    }

    gameState.matchSettings = settings;
    gameState.slotData = {};
    gameState.winner = null;

    // Gather all currently connected sockets
    let connectedSockets = Object.keys(gameState.players).filter(id => !gameState.players[id].isAI);
    if(hostId && !connectedSockets.includes(hostId)) connectedSockets.push(hostId);

    gameState.players = {}; // Clear all previous player state

    const slots = settings.slots || [];
    let usedSockets = [];

    // Pass 2: Assign AI
    slots.forEach(slot => {
        let validatedGold = Math.max(constants.MIN_GOLD, Math.min(constants.MAX_GOLD, slot.gold));

        if (slot.type === 'ai') {
            const aiId = `ai_${slot.index}`;
            createPlayer(aiId, slot.index, validatedGold, true, slot.difficulty);
        }
    });

    // Pass 3: All humans (including Host) become Observers initially
    connectedSockets.forEach(sid => {
        if (!usedSockets.includes(sid)) {
            createObserver(sid);
            setTimeout(() => checkAndEmitRoleSelection(io.sockets.sockets.get(sid)), 100);
        }
    });

    gameState.turn = null;
    gameState.turnCount = 1;
    gameState.isGameActive = true;

    // Determine initial turn only if all Open slots are filled OR if we have only AI/Closed
    // BUT actually, we want the game to start immediately, and empty slots just skip turn or wait?
    // Standard approach: Wait for players to fill "Open" slots before starting turn cycle.
    // However, the user request implies we might want to watch AI vs AI while waiting.

    // Compromise: We assign turn to the first slot.
    // If that slot is empty (disconnected/open), the game effectively "pauses" until someone joins it.
    // If it is AI, it runs.

    // We need to find the first player index (0 to 3) that is NOT closed.
    const activeSlots = slots.filter(s => s.type !== 'closed').sort((a,b) => a.index - b.index);
    if (activeSlots.length > 0) {
        // Find the player ID for this slot
        const firstSlotIndex = activeSlots[0].index;
        const player = Object.values(gameState.players).find(p => p.slotIndex === firstSlotIndex && !p.isObserver);

        if (player) {
            gameState.turn = player.id;
        } else {
            // Slot is open/waiting. We set turn to null or a placeholder to indicate waiting.
            // But 'startNewGame' usually implies we are ready.
            // Let's set turn to the *expected* player ID if it was an AI, or null if human hasn't joined.
            // Actually, if human hasn't joined, createPlayer wasn't called for them.
            // So we wait.
        }
    }

    io.emit('init', {
        state: gameState,
        myId: null,
        unitStats: unitStats,
        gameConstants: constants
    });

    io.emit('gameLog', { message: "--- NEW GAME STARTED ---" });

    // Check if first player is AI and exists
    checkForAiTurn();
}

function createPlayer(id, index, gold, isAI, difficulty) {
    const playerColor = constants.PLAYER_COLORS[index % constants.PLAYER_COLORS.length];
    const playerSymbol = index === 0 ? 'X' : (index === 1 ? 'O' : (index === 2 ? 'Y' : 'Z'));
    const baseArea = getBaseArea(index);

    // Independent Enumeration Logic
    let nameIndex = index + 1; // Default fallback

    if (gameState.matchSettings && gameState.matchSettings.slots) {
        // Sort slots by index to be sure
        const sortedSlots = [...gameState.matchSettings.slots].sort((a, b) => a.index - b.index);

        if (isAI) {
            // Count AIs
            const aiSlots = sortedSlots.filter(s => s.type === 'ai');
            const foundPos = aiSlots.findIndex(s => s.index === index);
            if (foundPos !== -1) {
                nameIndex = foundPos + 1;
            }
        } else {
            // Count Humans (anything not AI and not Closed)
            // 'me' and 'open' are the standard human types.
            const humanSlots = sortedSlots.filter(s => s.type !== 'ai' && s.type !== 'closed');
            const foundPos = humanSlots.findIndex(s => s.index === index);
            if (foundPos !== -1) {
                nameIndex = foundPos + 1;
            }
        }
    }

    let defaultName = isAI ? `Bot ${nameIndex}` : `Player ${nameIndex}`;

    // CHECK FOR PREVIOUS STATE (RECONNECTION)
    let finalGold = gold;
    if (gameState.slotData && gameState.slotData[index]) {
        finalGold = gameState.slotData[index].gold;
        if (gameState.slotData[index].name) {
            defaultName = gameState.slotData[index].name;
        }
        // Reclaim units
        const placeholderOwner = `disconnected_slot_${index}`;
        for(let r=0; r<constants.GRID_SIZE; r++) {
            for(let c=0; c<constants.GRID_SIZE; c++) {
                if(gameState.grid[r][c] && gameState.grid[r][c].owner === placeholderOwner) {
                    gameState.grid[r][c].owner = id;
                }
            }
        }
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
        slotIndex: index,
        isObserver: false,
        isDefeated: false,
        turnsWithoutUnits: 0
    };
}

function createObserver(id) {
    const observerCount = Object.values(gameState.players).filter(p => p.isObserver).length;
    gameState.players[id] = {
        id: id,
        name: `Observer ${observerCount + 1}`,
        color: '#95a5a6',
        isObserver: true,
        gold: 0,
        isAI: false
    };
}

function getBaseArea(playerIndex) {
    const G = constants.GRID_SIZE;
    const dimLong = Math.floor(G / 2);
    const dimShort = Math.floor(G / 20);
    const centerOffset = Math.floor((G - dimLong) / 2);

    if (playerIndex === 0) return { x: centerOffset, y: 0, width: dimLong, height: dimShort };
    if (playerIndex === 1) return { x: centerOffset, y: G - dimShort, width: dimLong, height: dimShort };
    if (playerIndex === 2) return { x: 0, y: centerOffset, width: dimShort, height: dimLong };
    if (playerIndex === 3) return { x: G - dimShort, y: centerOffset, width: dimShort, height: dimLong };
    return null;
}

function getAvailableSlots() {
    if (!gameState.matchSettings || !gameState.matchSettings.slots) return [];

    // Fix: Include AI players in 'takenIndices' to prevent AI slots from being offered as open
    const takenIndices = Object.values(gameState.players)
        .filter(p => !p.isObserver) // Removed && !p.isAI to ensure AI occupied slots count as taken
        .map(p => p.slotIndex);

    const available = [];

    gameState.matchSettings.slots.forEach(slot => {
        if (slot.type === 'me' || slot.type === 'open') {
            if (!takenIndices.includes(slot.index)) {
                const isReconnect = !!gameState.slotData[slot.index];
                let name = isReconnect ? (gameState.slotData[slot.index].name || "Disconnected Player") : "Open Slot";
                available.push({
                    index: slot.index,
                    isReconnect: isReconnect,
                    name: name,
                    color: constants.PLAYER_COLORS[slot.index]
                });
            }
        }
    });
    return available;
}

function checkAndEmitRoleSelection(socket) {
    if (!socket) return;
    const slots = getAvailableSlots();
    // Always emit roleSelection, even if empty, to ensure client UI clears invalid options
    socket.emit('roleSelection', slots);
}

// --- WIN/LOSS LOGIC ---

function checkWinConditions() {
    if (gameState.winner) return; // Already finished

    const activePlayers = Object.values(gameState.players).filter(p => !p.isObserver && !p.isDefeated);

    // Check Defeat Conditions for each active player
    activePlayers.forEach(p => {
        let unitCount = 0;
        for(let y=0; y<constants.GRID_SIZE; y++) {
            for(let x=0; x<constants.GRID_SIZE; x++) {
                if (gameState.grid[y][x] && gameState.grid[y][x].owner === p.id) {
                    unitCount++;
                }
            }
        }

        // Condition 1: No units & not enough gold for cheapest unit (50g)
        const isBankrupt = unitCount === 0 && p.gold < 50;

        // Condition 2: No units for 2 turns
        if (unitCount === 0) {
            // We increment this counter at end of turn. Just checking current state here.
        } else {
            p.turnsWithoutUnits = 0; // Reset if they have units
        }

        if (isBankrupt) {
            eliminatePlayer(p, "Bankruptcy");
        } else if (p.turnsWithoutUnits >= 2) {
            eliminatePlayer(p, "Attrition");
        }
    });

    // Check Victory Condition
    const remainingPlayers = Object.values(gameState.players).filter(p => !p.isObserver && !p.isDefeated);

    if (remainingPlayers.length === 1) {
        const winner = remainingPlayers[0];
        gameState.winner = winner.id;
        io.emit('gameLog', { message: `🏆 GAME OVER! ${winner.name} is the WINNER! 🏆` });
        io.emit('update', gameState);
    } else if (remainingPlayers.length === 0 && Object.values(gameState.players).some(p => !p.isObserver)) {
        // Tie or everyone quit/died
        io.emit('gameLog', { message: `GAME OVER! It's a Draw.` });
        gameState.winner = 'DRAW';
        io.emit('update', gameState);
    }
}

function eliminatePlayer(player, reason) {
    if (player.isDefeated) return;
    player.isDefeated = true;
    io.emit('gameLog', { message: `☠️ ${player.name} has been Defeated! (${reason})` });

    // Remove their units
    for(let y=0; y<constants.GRID_SIZE; y++) {
        for(let x=0; x<constants.GRID_SIZE; x++) {
            if (gameState.grid[y][x] && gameState.grid[y][x].owner === player.id) {
                gameState.grid[y][x] = null;
            }
        }
    }
}

// --- ACTION HANDLERS ---

function handleSpawnEntity(playerId, x, y, type) {
    if (gameState.winner) return;
    const player = gameState.players[playerId];
    if (!player || player.isObserver || player.isDefeated) return;
    if (playerId !== gameState.turn) return;

    if (player.baseArea) {
        if (x < player.baseArea.x || x >= player.baseArea.x + player.baseArea.width ||
            y < player.baseArea.y || y >= player.baseArea.y + player.baseArea.height) {
            return;
        }
    } else { return; }

    const terrain = gameState.terrainMap[y][x];
    if (terrain.id === 'water' || terrain.id === 'wall') return;

    if (!gameState.grid[y][x]) {
        const baseStats = unitStats[type];
        if (!baseStats) return;
        if (player.gold < baseStats.cost) return;

        let hasUnits = false;
        for(let r=0; r<constants.GRID_SIZE; r++) {
            for(let c=0; c<constants.GRID_SIZE; c++) {
                if (gameState.grid[r][c] && gameState.grid[r][c].owner === playerId) {
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
            owner: playerId,
            symbol: gameState.players[playerId].symbol,
            remainingMovement: 0,
            hasAttacked: true,
            ...baseStats,
            special_abilities: [...(baseStats.special_abilities || [])],
            current_health: baseStats.max_health,
            raw_morale: baseStats.initial_morale,
            current_morale: baseStats.initial_morale,
            facing_direction: 0,
            is_commander: isCommander,
            is_fleeing: false,
            morale_breakdown: []
        };

        let msg = `{p:${player.id}} recruited a {u:${type}:${x}:${y}:${player.id}}`;
        if (isCommander) msg += " as their Commander!";
        else msg += ".";
        io.emit('gameLog', { message: msg });
        gameLogic.updateAllUnitsMorale(gameState);
        io.emit('update', gameState);
    }
}

function handleMoveEntity(playerId, from, to) {
    if (gameState.winner) return;
    if (playerId !== gameState.turn) return;
    const entity = gameState.grid[from.y][from.x];
    const targetCell = gameState.grid[to.y][to.x];

    if (entity && entity.owner === playerId && !targetCell) {
        if (entity.is_fleeing) return;

        // Pass entity.speed as the last argument to enforce the strict movement rule
        const pathCost = gameLogic.getPathCost(
            from,
            to,
            gameState.grid,
            gameState.terrainMap,
            entity.remainingMovement,
            entity.speed
        );

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
}

function handleRotateEntity(playerId, x, y, direction) {
    if (gameState.winner) return;
    if (playerId !== gameState.turn) return;
    const entity = gameState.grid[y][x];
    if (entity && entity.owner === playerId && entity.remainingMovement >= 1) {
        if (entity.is_fleeing) return;
        entity.facing_direction = direction;
        entity.remainingMovement -= 1;
        gameLogic.updateAllUnitsMorale(gameState);
        io.emit('update', gameState);
    }
}

function handleAttackEntity(playerId, attackerPos, targetPos) {
    if (gameState.winner) return;
    if (playerId !== gameState.turn) return;
    const attacker = gameState.grid[attackerPos.y][attackerPos.x];
    const target = gameState.grid[targetPos.y][targetPos.x];
    if (attacker && attacker.is_fleeing) return;

    const combatResults = { events: [], logs: [] };

    if (!attacker || attacker.owner !== playerId || attacker.hasAttacked) return;

    if (target) {
        if (target.owner === playerId) return;
    } else {
        if (!attacker.is_ranged) return;
    }

    const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);
    const attackerTerrain = gameState.terrainMap[attackerPos.y][attackerPos.x];
    const targetTerrain = gameState.terrainMap[targetPos.y][targetPos.x];
    let effectiveRange = attacker.range;

    if (attacker.is_ranged && attackerTerrain.height > targetTerrain.height) {
        effectiveRange += constants.BONUS_HIGH_GROUND_RANGE;
    }

    if (dist <= effectiveRange) {
        if (attacker.is_ranged && !gameLogic.hasLineOfSight(attackerPos, targetPos, gameState.terrainMap)) return;
        if (!gameLogic.isValidAttackAngle(attacker, attackerPos, targetPos)) return;

        if (target) {
            combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} attacks {u:${target.type}:${targetPos.x}:${targetPos.y}:${target.owner}}!`);
        } else {
            combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} fires at (${targetPos.x}, ${targetPos.y})!`);
        }

        gameLogic.performCombat(attacker, attackerPos, target, targetPos, false, combatResults, gameState);

        const targetDestroyed = target && !gameState.grid[targetPos.y][targetPos.x];
        const isMelee = !attacker.is_ranged;
        attacker.hasAttacked = true;
        if (isMelee && targetDestroyed) {
            // Keep movement
        } else {
            attacker.remainingMovement = 0;
        }

        gameLogic.updateAllUnitsMorale(gameState);
        io.emit('update', gameState);
        io.emit('combatResults', combatResults);

        // Check for victory immediately after attack
        checkWinConditions();
    }
}

function handleEndTurn(playerId) {
    if (gameState.winner) return;
    if (playerId === gameState.turn) {
        const player = gameState.players[playerId];

        // --- Attrition Check at END of turn ---
        let unitCount = 0;
        for(let y=0; y<constants.GRID_SIZE; y++) {
            for(let x=0; x<constants.GRID_SIZE; x++) {
                if (gameState.grid[y][x] && gameState.grid[y][x].owner === playerId) {
                    unitCount++;
                }
            }
        }
        if (unitCount === 0) {
            player.turnsWithoutUnits = (player.turnsWithoutUnits || 0) + 1;
        } else {
            player.turnsWithoutUnits = 0;
        }

        checkWinConditions();
        if (gameState.winner) return;

        // Skip defeated players for next turn
        const activeIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver && !gameState.players[id].isDefeated);
        activeIds.sort((a,b) => gameState.players[a].slotIndex - gameState.players[b].slotIndex);

        if (activeIds.length === 0) return;

        const currentIndex = activeIds.indexOf(gameState.turn);

        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = 0; u.hasAttacked = true; });

        let nextIndex = (currentIndex + 1) % activeIds.length;
        gameState.turn = activeIds[nextIndex];

        if (nextIndex === 0) {
            gameState.turnCount++;
        }

        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });

        io.emit('gameLog', { message: `Turn changed to {p:${gameState.turn}}.` });

        // Handle morale phase and check win conditions if units flee
        gameLogic.handleMoralePhase(gameState.turn, gameState, io);
        checkWinConditions();

        io.emit('update', gameState);

        if (!gameState.winner) {
            checkForAiTurn();
        }
    }
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

// --- AI INTEGRATION ---

async function checkForAiTurn() {
    if (!gameState.turn || gameState.winner) return;
    const player = gameState.players[gameState.turn];

    // Crucial check: If the player does NOT exist (e.g. open slot), do not run AI logic
    if (!player) return;

    if (player.isAI && !player.isDefeated) {
        const callbacks = {
            move: (from, to) => handleMoveEntity(player.id, from, to),
            attack: (attacker, target) => handleAttackEntity(player.id, attacker, target),
            spawn: (x, y, type) => handleSpawnEntity(player.id, x, y, type),
            rotate: (x, y, dir) => handleRotateEntity(player.id, x, y, dir),
            endTurn: () => handleEndTurn(player.id)
        };

        // Run AI, then when it finishes, check again (allows AI vs AI)
        await aiLogic.executeTurn(gameState, player.id, gameLogic, callbacks);

        // After AI finishes turn, it calls handleEndTurn, which calls checkForAiTurn again.
        // This creates the loop for AI vs AI.
    }
}

// --- SOCKET LISTENERS ---

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    createObserver(socket.id);

    socket.emit('init', {
        state: gameState,
        myId: socket.id,
        unitStats: unitStats,
        gameConstants: constants
    });
    socket.emit('update', gameState);
    checkAndEmitRoleSelection(socket);

    socket.on('chooseSlot', (slotIndex) => {
        const slotConfig = gameState.matchSettings.slots.find(s => s.index === slotIndex);
        if (!slotConfig) return;

        // Fix: Check ALL non-observer players (including AI) to see if slot is taken
        const takenIndices = Object.values(gameState.players)
            .filter(p => !p.isObserver)
            .map(p => p.slotIndex);

        if (takenIndices.includes(slotIndex)) {
            socket.emit('gameLog', { message: "That slot was just taken." });
            checkAndEmitRoleSelection(socket);
            return;
        }

        delete gameState.players[socket.id];
        createPlayer(socket.id, slotIndex, slotConfig.gold, false, null);

        // If turn was null (all disconnected/empty), set turn to this player
        // BUT we must respect order.
        // If turn is NULL, we are starting fresh or resuming from empty.
        // If it's this player's index that corresponds to current turn (which might be null if 0 index)
        // logic is tricky.

        // Simplified: If turn is null, set it to the first active player found.
        if (gameState.turn === null) {
            const activeIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver && !gameState.players[id].isDefeated);
            activeIds.sort((a,b) => gameState.players[a].slotIndex - gameState.players[b].slotIndex);
            if (activeIds.length > 0) {
                gameState.turn = activeIds[0];
                checkForAiTurn(); // In case the first player is AI? No, human joined.
            }
        } else {
            // If turn was waiting on THIS slot
            // We need to check if the current turn ID corresponds to a player that didn't exist until now?
            // No, the ID changes on connect.
            // If the game logic says "It is Player 1's turn" but Player 1 wasn't there...

            // Actually, handleDisconnect passes turn.
            // So if I join, I am just waiting for my turn unless I am the ONLY player.
        }

        io.emit('update', gameState);
        io.emit('gameLog', { message: `{p:${socket.id}} has joined the game.` });

        Object.values(io.sockets.sockets).forEach(s => {
            const p = gameState.players[s.id];
            if(p && p.isObserver) checkAndEmitRoleSelection(s);
        });
    });

    socket.on('startGame', (settings) => {
        console.log("Starting new game with settings:", settings);
        startNewGame(settings, socket.id);
    });

    socket.on('changeName', (newName) => {
        const player = gameState.players[socket.id];
        if (player) {
            const cleanName = newName.trim().substring(0, 12) || player.name;
            player.name = cleanName;
            io.emit('update', gameState);
        }
    });

    socket.on('requestSave', () => {
        socket.emit('saveGameData', gameState);
    });

    socket.on('loadGame', (data) => {
        if (!data || !data.grid || !data.players) return;
        gameState.grid = data.grid;
        gameState.terrainMap = data.terrainMap;
        gameState.turnCount = data.turnCount;
        gameState.isGameActive = true;
        gameState.matchSettings = data.matchSettings || { slots: [] };
        gameState.slotData = {};
        gameState.winner = data.winner || null;

        gameState.players = {};
        io.sockets.sockets.forEach((s) => createObserver(s.id));

        Object.values(data.players).forEach(p => {
            if (!p.isAI && !p.isObserver) {
                gameState.slotData[p.slotIndex] = { gold: p.gold, name: p.name };
            } else if (p.isAI) {
                createPlayer(p.id, p.slotIndex, p.gold, true, p.difficulty);
                if (p.isDefeated) gameState.players[p.id].isDefeated = true;
            }
        });

        io.emit('init', { state: gameState, myId: null, unitStats, gameConstants: constants });
        io.sockets.sockets.forEach((s) => checkAndEmitRoleSelection(s));

        checkForAiTurn();
    });

    socket.on('spawnEntity', ({ x, y, type }) => handleSpawnEntity(socket.id, x, y, type));
    socket.on('moveEntity', ({ from, to }) => handleMoveEntity(socket.id, from, to));
    socket.on('rotateEntity', ({ x, y, direction }) => handleRotateEntity(socket.id, x, y, direction));
    socket.on('attackEntity', ({ attackerPos, targetPos }) => handleAttackEntity(socket.id, attackerPos, targetPos));
    socket.on('endTurn', () => handleEndTurn(socket.id));

    socket.on('disconnect', () => {
        const player = gameState.players[socket.id];

        if (player && !player.isObserver) {
            gameState.slotData[player.slotIndex] = {
                gold: player.gold,
                name: player.name
            };

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

        if (player && !player.isObserver && gameState.turn === socket.id) {
            // Pass turn immediately if current player disconnects
            const activeIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isObserver && !gameState.players[id].isDefeated);
            activeIds.sort((a,b) => gameState.players[a].slotIndex - gameState.players[b].slotIndex);

            if (activeIds.length > 0) {
                // Find next player index
                // Since this player is removed, we just pick the first available one?
                // Or maintain order. Since 'player' object is gone from 'players',
                // activeIds does not contain it.
                // We should find the next slot index > disconnected slot index.

                let nextId = activeIds.find(id => gameState.players[id].slotIndex > player.slotIndex);
                if (!nextId) nextId = activeIds[0]; // Wrap around

                gameState.turn = nextId;

                modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });
                io.emit('gameLog', { message: `Player disconnected. Turn passed to {p:${gameState.turn}}.` });
                checkForAiTurn();
            } else {
                gameState.turn = null;
            }
        }
        io.emit('update', gameState);

        Object.values(io.sockets.sockets).forEach(s => {
            const p = gameState.players[s.id];
            if(p && p.isObserver) checkAndEmitRoleSelection(s);
        });
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));