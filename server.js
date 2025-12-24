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
    grid: Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null)),
    terrainMap: Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(constants.TERRAIN.PLAINS)),
    players: {},
    turn: null
};

// Generate initial map
mapGenerator.generateMap(gameState);

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    const existingPlayers = Object.keys(gameState.players);
    const playerSymbol = existingPlayers.length === 0 ? 'X' : 'O';
    const playerColor = constants.PLAYER_COLORS[existingPlayers.length % constants.PLAYER_COLORS.length];

    const playerCount = existingPlayers.length + 1;
    const defaultName = `Player${playerCount}`;

    // Assign Base Area
    let baseArea = null;
    const spawnHeight = constants.MAP_GEN.SPAWN_ZONE_HEIGHT;

    // Player 1 gets Top, Player 2 gets Bottom. Subsequent players act as spectators/no-spawn for now.
    if (existingPlayers.length === 0) {
        baseArea = { x: 0, y: 0, width: constants.GRID_SIZE, height: spawnHeight };
    } else if (existingPlayers.length === 1) {
        baseArea = { x: 0, y: constants.GRID_SIZE - spawnHeight, width: constants.GRID_SIZE, height: spawnHeight };
    }

    gameState.players[socket.id] = {
        symbol: playerSymbol,
        color: playerColor,
        id: socket.id,
        name: defaultName,
        gold: constants.STARTING_GOLD,
        baseArea: baseArea
    };

    if (!gameState.turn) gameState.turn = socket.id;

    socket.emit('init', {
        state: gameState,
        myId: socket.id,
        unitStats: unitStats
    });

    io.emit('update', gameState);

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
                // Should return if attempting to spawn outside base
                return;
            }
        } else {
            // No base assigned (spectator?), cannot spawn
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

    function endTurn() {
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = 0; u.hasAttacked = true; });
        const ids = Object.keys(gameState.players);
        const currentIndex = ids.indexOf(gameState.turn);
        const nextIndex = (currentIndex + 1) % ids.length;
        gameState.turn = ids[nextIndex];
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