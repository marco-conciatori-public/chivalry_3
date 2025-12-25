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
    isGameActive: false // Track if the game is in Lobby or Playing state
};

// Start initial game with defaults but keep it inactive (Lobby mode)
startNewGame({
    gridSize: constants.GRID_SIZE,
    startingGold: constants.STARTING_GOLD,
    aiCount: 0
});
// Force inactive state after initial setup so players see the setup screen first
gameState.isGameActive = false;

function startNewGame(settings) {
    // 1. Update Constants (Runtime Override)
    constants.GRID_SIZE = parseInt(settings.gridSize);
    constants.STARTING_GOLD = parseInt(settings.startingGold);

    // 2. Reset Grid & Terrain
    gameState.grid = Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null));
    gameState.terrainMap = Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(constants.TERRAIN.PLAINS));

    // 3. Regenerate Map
    mapGenerator.generateMap(gameState);

    // 4. Handle Players (Reset Existing, Add AI)
    // We keep existing human connections but reset their state
    const currentSocketIds = Object.keys(gameState.players).filter(id => !gameState.players[id].isAI);
    gameState.players = {}; // Clear all

    // Re-add humans
    currentSocketIds.forEach((socketId, index) => {
        addPlayerToGame(socketId, index);
    });

    // Add AI Players
    const aiCount = parseInt(settings.aiCount || 0);
    const humanCount = currentSocketIds.length;

    for(let i=0; i<aiCount; i++) {
        const aiId = `ai_${i+1}`;
        const totalIndex = humanCount + i;
        if(totalIndex < 4) { // Max 4 players supported by base logic
            const playerColor = constants.PLAYER_COLORS[totalIndex % constants.PLAYER_COLORS.length];
            const baseArea = getBaseArea(totalIndex);

            gameState.players[aiId] = {
                symbol: 'A',
                color: playerColor,
                id: aiId,
                name: `Bot ${i+1}`,
                gold: constants.STARTING_GOLD,
                baseArea: baseArea,
                isAI: true,
                difficulty: settings.aiDifficulty || 'normal'
            };
        }
    }

    // 5. Set Turn
    const allIds = Object.keys(gameState.players);
    gameState.turn = allIds.length > 0 ? allIds[0] : null;
    gameState.turnCount = 1;

    // 6. Set Game Active
    gameState.isGameActive = true;

    // 7. Broadcast new state
    io.emit('init', {
        state: gameState,
        myId: null, // Client ignores this in general update, but init handler needs structure
        unitStats: unitStats
    });

    io.emit('gameLog', { message: "--- NEW GAME STARTED ---" });
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

function addPlayerToGame(socketId, indexOverride = null) {
    const existingPlayers = Object.keys(gameState.players);
    // If indexOverride is provided (during reset), use it. Otherwise append.
    const playerIndex = indexOverride !== null ? indexOverride : existingPlayers.length;

    const playerSymbol = playerIndex === 0 ? 'X' : 'O';
    const playerColor = constants.PLAYER_COLORS[playerIndex % constants.PLAYER_COLORS.length];
    const defaultName = `Player${playerIndex + 1}`;
    const baseArea = getBaseArea(playerIndex);

    gameState.players[socketId] = {
        symbol: playerSymbol,
        color: playerColor,
        id: socketId,
        name: defaultName,
        gold: constants.STARTING_GOLD,
        baseArea: baseArea,
        isAI: false
    };
}

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // Add new player to current game
    addPlayerToGame(socket.id);

    // If this is the first player, ensure turn is set
    if (!gameState.turn) gameState.turn = socket.id;

    socket.emit('init', {
        state: gameState,
        myId: socket.id,
        unitStats: unitStats
    });

    io.emit('update', gameState);

    socket.on('startGame', (settings) => {
        console.log("Starting new game with settings:", settings);
        startNewGame(settings);
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
        if (socket.id !== gameState.turn) return;
        const player = gameState.players[socket.id];
        if (!player) return;

        // Check if spawn is within player's base area
        if (player.baseArea) {
            if (x < player.baseArea.x || x >= player.baseArea.x + player.baseArea.width ||
                y < player.baseArea.y || y >= player.baseArea.y + player.baseArea.height) {
                // Return if attempting to spawn outside base
                return;
            }
        } else {
            // No base assigned (spectator or >4 players), cannot spawn
            return;
        }

        const terrain = gameState.terrainMap[y][x];
        if (terrain.cost > constants.MAP_GEN.IMPASSABLE_THRESHOLD) return;

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
                current_health: baseStats.max_health,
                raw_morale: baseStats.initial_morale,
                current_morale: baseStats.initial_morale,
                facing_direction: 0,
                is_commander: isCommander,
                is_fleeing: false,
                morale_breakdown: []
            };

            // UPDATED: Send player.id instead of player.name so client can update dynamic names
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

        if (attacker && target && attacker.owner === socket.id && target.owner !== socket.id && !attacker.hasAttacked) {
            const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);

            const attackerTerrain = gameState.terrainMap[attackerPos.y][attackerPos.x];
            let effectiveRange = attacker.range;
            if (attackerTerrain.highGround && attacker.is_ranged) {
                effectiveRange += 1;
            }

            if (dist <= effectiveRange) {
                if (attacker.is_ranged && !gameLogic.hasLineOfSight(attackerPos, targetPos, gameState.terrainMap)) {
                    return;
                }

                combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} attacks {u:${target.type}:${targetPos.x}:${targetPos.y}:${target.owner}}!`);

                gameLogic.performCombat(attacker, attackerPos, target, targetPos, false, combatResults, gameState);

                attacker.hasAttacked = true;
                attacker.remainingMovement = 0;

                gameLogic.updateAllUnitsMorale(gameState);
                io.emit('update', gameState);
                io.emit('combatResults', combatResults);
            }
        }
    });

    socket.on('endTurn', () => {
        if (socket.id === gameState.turn) {
            endTurn();
        }
    });

    function endTurn() {
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = 0; u.hasAttacked = true; });
        const ids = Object.keys(gameState.players);
        const currentIndex = ids.indexOf(gameState.turn);
        const nextIndex = (currentIndex + 1) % ids.length;
        gameState.turn = ids[nextIndex];

        // Increment global turn counter only when the cycle wraps around to the first player
        if (nextIndex === 0) {
            gameState.turnCount++;
        }

        const nextPlayer = gameState.players[gameState.turn];
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
        delete gameState.players[socket.id];
        if (gameState.turn === socket.id) {
            const ids = Object.keys(gameState.players);
            gameState.turn = ids.length > 0 ? ids[0] : null;
            if(gameState.turn) {
                modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });
            }
        }
        io.emit('update', gameState);
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));