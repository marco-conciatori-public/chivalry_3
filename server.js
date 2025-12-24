const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats');
const constants = require('./constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
    grid: Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(null)),
    terrainMap: Array(constants.GRID_SIZE).fill(null).map(() => Array(constants.GRID_SIZE).fill(constants.TERRAIN.PLAINS)),
    players: {},
    turn: null
};

// --- MAP GENERATION ---
function generateMap() {
    // 1. Reset to Plains
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            gameState.terrainMap[y][x] = constants.TERRAIN.PLAINS;
        }
    }

    const isValidZone = (x, y) => x >= 0 && x < constants.GRID_SIZE && y >= 2 && y < constants.GRID_SIZE - 2;

    const areaScale = (constants.GRID_SIZE * constants.GRID_SIZE) / 100;

    // 2. STREETS (Generate these early so they form a network)
    // Create a few main roads
    const numStreets = Math.floor(Math.random() * 2) + 2; // 2-3 main roads base
    const totalStreets = Math.floor(numStreets * Math.sqrt(areaScale)); // Scale by linear dimension approx

    for(let i=0; i<totalStreets; i++) {
        let x = Math.floor(Math.random() * constants.GRID_SIZE);
        let y = Math.floor(Math.random() * constants.GRID_SIZE);

        // Random Walk for street
        let length = Math.floor(constants.GRID_SIZE * 0.8);
        let dir = Math.random() < 0.5 ? 0 : 1; // 0: Horizontal, 1: Vertical preference

        for(let j=0; j<length; j++) {
            if(isValidZone(x, y)) {
                gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
            }

            // Move
            if (dir === 0) {
                x += (Math.random() < 0.8 ? 1 : 0); // Bias East
                y += (Math.random() < 0.2 ? (Math.random() < 0.5 ? 1 : -1) : 0);
            } else {
                y += (Math.random() < 0.8 ? 1 : 0); // Bias South
                x += (Math.random() < 0.2 ? (Math.random() < 0.5 ? 1 : -1) : 0);
            }

            // Wrap/Bound check
            x = Math.max(0, Math.min(constants.GRID_SIZE-1, x));
            y = Math.max(0, Math.min(constants.GRID_SIZE-1, y));
        }
    }


    // 3. MOUNTAINS (Reduced)
    // Reduced modifier from 0.6 to 0.3
    const baseMountains = Math.floor(Math.random() * 2) + 1;
    const targetMountainGroups = Math.floor(baseMountains * areaScale * 0.3);

    let mountainAttempts = 0;
    let groupsPlaced = 0;

    while(groupsPlaced < targetMountainGroups && mountainAttempts < (2000 * areaScale)) {
        mountainAttempts++;
        const size = Math.random() < 0.5 ? 2 : 3;

        const mx = Math.floor(Math.random() * (constants.GRID_SIZE - size - 2)) + 1;
        const my = Math.floor(Math.random() * (constants.GRID_SIZE - size - 6)) + 3;

        let canPlace = true;
        for (let y = my - 1; y < my + size + 1; y++) {
            for (let x = mx - 1; x < mx + size + 1; x++) {
                // Don't overwrite existing mountains or streets (keep streets clear if possible, or overwrite? Overwrite is ok for mountains)
                // Actually, let's strictly avoid overlap with other mountains, but overwrite plains/streets
                if (gameState.terrainMap[y][x].id === 'mountain') {
                    canPlace = false;
                    break;
                }
            }
            if (!canPlace) break;
        }

        if (canPlace) {
            for (let y = my; y < my + size; y++) {
                for (let x = mx; x < mx + size; x++) {
                    gameState.terrainMap[y][x] = constants.TERRAIN.MOUNTAIN;
                }
            }
            groupsPlaced++;
        }
    }

    // 4. Walls (Lines) - Reduced
    // Reduced multiplier from 0.5 to 0.25
    const baseWalls = Math.floor(Math.random() * 2) + 1;
    const numWalls = Math.floor(baseWalls * areaScale * 0.25);

    for (let i = 0; i < numWalls; i++) {
        let startX = Math.floor(Math.random() * constants.GRID_SIZE);
        let startY = Math.floor(Math.random() * (constants.GRID_SIZE - 4)) + 2;
        let isVertical = Math.random() < 0.5;
        let length = Math.floor(Math.random() * 6) + 3;

        for (let l = 0; l < length; l++) {
            let wx = isVertical ? startX : startX + l;
            let wy = isVertical ? startY + l : startY;

            // Only overwrite plains or streets (walls block streets)
            if (isValidZone(wx, wy) && (gameState.terrainMap[wy][wx].id === 'plains' || gameState.terrainMap[wy][wx].id === 'street')) {
                gameState.terrainMap[wy][wx] = constants.TERRAIN.WALL;
            }
        }
    }

    // 5. Forests (Organic Blobs)
    const baseForests = Math.floor(Math.random() * 2) + 2;
    const numForests = Math.floor(baseForests * areaScale * 0.7);

    for (let i = 0; i < numForests; i++) {
        let cx = Math.floor(Math.random() * constants.GRID_SIZE);
        let cy = Math.floor(Math.random() * (constants.GRID_SIZE - 4)) + 2;

        if (isValidZone(cx, cy)) {
            const blobSize = Math.floor(Math.random() * 8) + 4;
            let openSet = [{x: cx, y: cy}];
            let placedCount = 0;

            while(placedCount < blobSize && openSet.length > 0) {
                let idx = Math.floor(Math.random() * openSet.length);
                let current = openSet.splice(idx, 1)[0];

                if (isValidZone(current.x, current.y)) {
                    // Forests can grow over plains and streets
                    if (gameState.terrainMap[current.y][current.x].id === 'plains' || gameState.terrainMap[current.y][current.x].id === 'street') {
                        gameState.terrainMap[current.y][current.x] = constants.TERRAIN.FOREST;
                        placedCount++;
                        [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}].forEach(({dx, dy}) => {
                            openSet.push({x: current.x + dx, y: current.y + dy});
                        });
                    }
                }
            }
        }
    }

    // 6. Water (Rivers)
    const numRivers = Math.max(1, Math.floor(areaScale * 0.15));
    for(let r=0; r<numRivers; r++) {
        let rx = Math.floor(Math.random() * constants.GRID_SIZE);
        let ry = Math.floor(Math.random() * (constants.GRID_SIZE - 4)) + 2;
        let riverLength = Math.floor(constants.GRID_SIZE * 1.5);

        for(let i=0; i<riverLength; i++) {
            if (isValidZone(rx, ry)) {
                // Rivers overwrite everything except mountains (water flows around)
                if (gameState.terrainMap[ry][rx].id !== 'mountain') {
                    gameState.terrainMap[ry][rx] = constants.TERRAIN.WATER;
                }
            }
            let move = Math.random();
            if (move < 0.5) rx += (Math.random() < 0.5 ? 1 : -1);
            else ry += (Math.random() < 0.5 ? 1 : -1);
        }
    }
}
generateMap();

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    const existingPlayers = Object.keys(gameState.players);
    const playerSymbol = existingPlayers.length === 0 ? 'X' : 'O';
    const playerColor = constants.PLAYER_COLORS[existingPlayers.length % constants.PLAYER_COLORS.length];

    const playerCount = existingPlayers.length + 1;
    const defaultName = `Player${playerCount}`;

    gameState.players[socket.id] = {
        symbol: playerSymbol,
        color: playerColor,
        id: socket.id,
        name: defaultName,
        gold: constants.STARTING_GOLD
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

        const terrain = gameState.terrainMap[y][x];
        if (terrain.cost > 10) return;

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

            let msg = `{p:${player.name}} recruited a {u:${type}:${x}:${y}:${player.id}}`;
            if (isCommander) msg += " as their Commander!";
            else msg += ".";
            io.emit('gameLog', { message: msg });

            updateAllUnitsMorale();
            io.emit('update', gameState);
        }
    });

    socket.on('moveEntity', ({ from, to }) => {
        if (socket.id !== gameState.turn) return;

        const entity = gameState.grid[from.y][from.x];
        const targetCell = gameState.grid[to.y][to.x];

        if (entity && entity.owner === socket.id && !targetCell) {
            if (entity.is_fleeing) return;

            const pathCost = getPathCost(from, to, gameState.grid, gameState.terrainMap, entity.remainingMovement);

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

                updateAllUnitsMorale();
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

            updateAllUnitsMorale();
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
                if (attacker.is_ranged && !hasLineOfSight(attackerPos, targetPos)) {
                    return;
                }

                combatResults.logs.push(`{u:${attacker.type}:${attackerPos.x}:${attackerPos.y}:${attacker.owner}} attacks {u:${target.type}:${targetPos.x}:${targetPos.y}:${target.owner}}!`);
                performCombat(attacker, attackerPos, target, targetPos, false, combatResults);

                attacker.hasAttacked = true;
                attacker.remainingMovement = 0;

                updateAllUnitsMorale();
                io.emit('update', gameState);
                io.emit('combatResults', combatResults);
            }
        }
    });

    function performCombat(attacker, attackerPos, defender, defenderPos, isRetaliation, combatResults) {
        const damage = calculateDamage(attacker, attackerPos, defender, defenderPos, false);

        defender.raw_morale -= damage;
        if (!isRetaliation || defender.is_melee_capable) {
            attacker.raw_morale += Math.floor(damage / 2);
        }

        combatResults.events.push({
            x: defenderPos.x,
            y: defenderPos.y,
            type: 'damage',
            value: damage,
            color: '#e74c3c'
        });

        combatResults.logs.push(` -> Dealt ${damage} damage to {u:${defender.type}:${defenderPos.x}:${defenderPos.y}:${defender.owner}}.`);

        const killed = applyDamage(defender, defenderPos, damage);

        if (killed) {
            combatResults.events.push({ x: defenderPos.x, y: defenderPos.y, type: 'death', value: '💀' });
            combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}:${defender.owner}} was destroyed!`);
            applyDeathMoraleEffects(defenderPos, defender.owner);
        }

        if (attacker.is_ranged && !isRetaliation) {
            const neighbors = [
                {x: defenderPos.x, y: defenderPos.y - 1},
                {x: defenderPos.x, y: defenderPos.y + 1},
                {x: defenderPos.x - 1, y: defenderPos.y},
                {x: defenderPos.x + 1, y: defenderPos.y}
            ];

            neighbors.forEach(pos => {
                if (pos.x >= 0 && pos.x < constants.GRID_SIZE && pos.y >= 0 && pos.y < constants.GRID_SIZE) {
                    const neighborUnit = gameState.grid[pos.y][pos.x];
                    if (neighborUnit) {
                        const splashDamage = calculateDamage(attacker, attackerPos, neighborUnit, pos, true);
                        neighborUnit.raw_morale -= splashDamage;
                        combatResults.events.push({ x: pos.x, y: pos.y, type: 'damage', value: splashDamage, color: '#e67e22' });
                        combatResults.logs.push(` -> Splash hit {u:${neighborUnit.type}:${pos.x}:${pos.y}:${neighborUnit.owner}} for ${splashDamage} damage.`);

                        const splashKilled = applyDamage(neighborUnit, pos, splashDamage);
                        if (splashKilled) {
                            combatResults.events.push({ x: pos.x, y: pos.y, type: 'death', value: '💀' });
                            applyDeathMoraleEffects(pos, neighborUnit.owner);
                        }
                    }
                }
            });
        }

        if (!isRetaliation && defender.current_health > 0 && defender.is_melee_capable) {
            const dist = Math.abs(attackerPos.x - defenderPos.x) + Math.abs(attackerPos.y - defenderPos.y);
            if (dist === 1) {
                combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}:${defender.owner}} retaliates!`);
                performCombat(defender, defenderPos, attacker, attackerPos, true, combatResults);
            }
        }
    }

    function applyDeathMoraleEffects(pos, ownerId) {
        const neighbors = [{x: pos.x, y: pos.y - 1}, {x: pos.x, y: pos.y + 1}, {x: pos.x - 1, y: pos.y}, {x: pos.x + 1, y: pos.y}];
        neighbors.forEach(n => {
            if (n.x >= 0 && n.x < constants.GRID_SIZE && n.y >= 0 && n.y < constants.GRID_SIZE) {
                const witness = gameState.grid[n.y][n.x];
                if (witness && !witness.is_fleeing) {
                    if (witness.owner === ownerId) witness.raw_morale -= 10;
                    else witness.raw_morale += 10;
                }
            }
        });
    }

    function calculateDamage(attacker, attackerPos, defender, defenderPos, isSplash) {
        let bonusDamage = 0;
        if (attacker.bonus_vs && attacker.bonus_vs.includes(defender.type)) {
            bonusDamage = constants.BONUS_DAMAGE;
        }

        let bonusShield = 0;
        if (defender.has_shield) {
            const dx = attackerPos.x - defenderPos.x;
            const dy = attackerPos.y - defenderPos.y;
            let isShielded = false;
            if (defender.facing_direction === 0) { if (dy < 0 && dx === 0) isShielded = true; if (dx < 0 && dy === 0) isShielded = true; }
            if (defender.facing_direction === 2) { if (dx > 0 && dy === 0) isShielded = true; if (dy < 0 && dx === 0) isShielded = true; }
            if (defender.facing_direction === 4) { if (dy > 0 && dx === 0) isShielded = true; if (dx > 0 && dy === 0) isShielded = true; }
            if (defender.facing_direction === 6) { if (dx < 0 && dy === 0) isShielded = true; if (dy > 0 && dx === 0) isShielded = true; }

            if (isShielded) bonusShield = constants.BONUS_SHIELD;
        }

        const tile = gameState.terrainMap[defenderPos.y][defenderPos.x];
        const terrainDefense = tile.defense || 0;

        let highGroundBonus = 0;
        const attackerTile = gameState.terrainMap[attackerPos.y][attackerPos.x];
        if (attackerTile.highGround) {
            highGroundBonus = 10;
        }

        const healthFactor = constants.MIN_DAMAGE_REDUCTION_BY_HEALTH + ((attacker.current_health / attacker.max_health) * (1 - constants.MIN_DAMAGE_REDUCTION_BY_HEALTH));

        const defenseFactor = 1 - ((defender.defence + bonusShield + terrainDefense) / 100);
        const clampedDefenseFactor = Math.max(constants.MAX_DAMAGE_REDUCTION_BY_DEFENSE, defenseFactor);

        let baseDamage = (attacker.attack + bonusDamage + highGroundBonus) * healthFactor * clampedDefenseFactor;

        if (attacker.is_ranged) {
            if (isSplash) baseDamage *= ((100 - attacker.accuracy) / 100);
            else baseDamage *= (attacker.accuracy / 100);
        }

        const randomFactor = constants.DAMAGE_RANDOM_BASE + (Math.random() * constants.DAMAGE_RANDOM_VARIANCE);
        baseDamage *= randomFactor;

        return Math.floor(baseDamage);
    }

    function applyDamage(unit, pos, amount) {
        unit.current_health -= amount;
        if (unit.current_health <= 0) {
            unit.current_health = 0;
            gameState.grid[pos.y][pos.x] = null;
            return true;
        }
        return false;
    }

    socket.on('endTurn', () => {
        if (socket.id !== gameState.turn) return;
        endTurn();
    });

    function getPathCost(start, end, grid, terrainMap, maxMoves) {
        if (start.x === end.x && start.y === end.y) return 0;

        let costs = {};
        let queue = [{x: start.x, y: start.y, cost: 0}];
        costs[`${start.x},${start.y}`] = 0;

        while(queue.length > 0) {
            queue.sort((a,b) => a.cost - b.cost);
            let current = queue.shift();

            if (current.x === end.x && current.y === end.y) return current.cost;
            if (current.cost >= maxMoves) continue;

            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (const [dx, dy] of dirs) {
                const nx = current.x + dx;
                const ny = current.y + dy;

                if (nx >= 0 && nx < constants.GRID_SIZE && ny >= 0 && ny < constants.GRID_SIZE) {
                    const key = `${nx},${ny}`;
                    const targetTerrain = terrainMap[ny][nx];

                    if (targetTerrain.cost > 10) continue;
                    if (grid[ny][nx] && (nx !== end.x || ny !== end.y)) continue;
                    if (grid[ny][nx]) continue;

                    const newCost = current.cost + targetTerrain.cost;

                    if (newCost <= maxMoves) {
                        if (costs[key] === undefined || newCost < costs[key]) {
                            costs[key] = newCost;
                            queue.push({x: nx, y: ny, cost: newCost});
                        }
                    }
                }
            }
        }
        return -1;
    }

    function getPathDistance(start, end, grid) {
        return -1;
    }

    function hasLineOfSight(start, end) {
        let x0 = start.x;
        let y0 = start.y;
        let x1 = end.x;
        let y1 = end.y;

        let dx = Math.abs(x1 - x0);
        let dy = Math.abs(y1 - y0);
        let sx = (x0 < x1) ? 1 : -1;
        let sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if ((x0 !== start.x || y0 !== start.y) && (x0 !== end.x || y0 !== end.y)) {
                if (gameState.terrainMap[y0][x0].blocksLos) {
                    return false;
                }
            }

            if (x0 === x1 && y0 === y1) break;
            let e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
        return true;
    }

    function updateAllUnitsMorale() {
        for (let y = 0; y < constants.GRID_SIZE; y++) {
            for (let x = 0; x < constants.GRID_SIZE; x++) {
                const entity = gameState.grid[y][x];
                if (entity) {
                    calculateCurrentMorale(entity, x, y);
                }
            }
        }
    }

    function calculateCurrentMorale(unit, x, y) {
        let breakdown = [];
        if (unit.raw_morale > constants.MAX_MORALE) unit.raw_morale = constants.MAX_MORALE;
        let morale = unit.raw_morale;
        breakdown.push({ label: "Base Stats", value: unit.initial_morale });

        const eventDiff = unit.raw_morale - unit.initial_morale;
        if (eventDiff !== 0) breakdown.push({ label: "Battle Events", value: eventDiff });

        let adjacentAllies = 0;
        let adjacentEnemies = 0;
        let flankingEnemies = 0;
        let rearEnemies = 0;

        const neighbors = [{dx: 0, dy: -1}, {dx: 0, dy: 1}, {dx: -1, dy: 0}, {dx: 1, dy: 0}];

        neighbors.forEach(({dx, dy}) => {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < constants.GRID_SIZE && ny >= 0 && ny < constants.GRID_SIZE) {
                const other = gameState.grid[ny][nx];
                if (other && !other.is_fleeing) {
                    if (other.owner === unit.owner) {
                        adjacentAllies++;
                    } else {
                        adjacentEnemies++;
                        const relation = getRelativePosition(unit.facing_direction, dx, dy);
                        if (relation === 'FLANK') flankingEnemies++;
                        if (relation === 'REAR') rearEnemies++;
                    }
                }
            }
        });

        if (adjacentAllies > 0) { morale += (adjacentAllies * 10); breakdown.push({ label: "Adj. Allies", value: adjacentAllies * 10 }); }
        if (adjacentEnemies > 1) { const val = -((adjacentEnemies - 1) * 10); morale += val; breakdown.push({ label: "Swarmed", value: val }); }
        if (flankingEnemies > 0) { const val = -(flankingEnemies * 10); morale += val; breakdown.push({ label: "Flanked", value: val }); }
        if (rearEnemies > 0) { const val = -(rearEnemies * 20); morale += val; breakdown.push({ label: "Rear Att.", value: val }); }

        if (unit.is_commander) { morale += 20; breakdown.push({ label: "Commander", value: 20 }); }

        if (!unit.is_commander) {
            let commanderNearby = false;
            for(let cy=0; cy<constants.GRID_SIZE; cy++) {
                for(let cx=0; cx<constants.GRID_SIZE; cx++) {
                    const cUnit = gameState.grid[cy][cx];
                    if (cUnit && cUnit.owner === unit.owner && cUnit.is_commander && !cUnit.is_fleeing) {
                        const dist = Math.abs(x - cx) + Math.abs(y - cy);
                        if (dist <= constants.COMMANDER_INFLUENCE_RANGE) {
                            commanderNearby = true;
                        }
                    }
                }
            }
            if (commanderNearby) { morale += 10; breakdown.push({ label: "Cmdr Aura", value: 10 }); }
        }
        if (morale > constants.MAX_MORALE) morale = constants.MAX_MORALE;
        unit.current_morale = morale;
        unit.morale_breakdown = breakdown;
    }

    function getRelativePosition(facing, dx, dy) {
        if (facing === 0 && dy === 1 && dx === 0) return 'REAR';
        if (facing === 2 && dx === -1 && dy === 0) return 'REAR';
        if (facing === 4 && dy === -1 && dx === 0) return 'REAR';
        if (facing === 6 && dx === 1 && dy === 0) return 'REAR';
        if (facing === 0 && dy === 0) return 'FLANK';
        if (facing === 4 && dy === 0) return 'FLANK';
        if (facing === 2 && dx === 0) return 'FLANK';
        if (facing === 6 && dx === 0) return 'FLANK';
        return 'FRONT';
    }

    function handleMoralePhase(playerId) {
        updateAllUnitsMorale();
        let unitsToProcess = [];
        for (let y = 0; y < constants.GRID_SIZE; y++) {
            for (let x = 0; x < constants.GRID_SIZE; x++) {
                const entity = gameState.grid[y][x];
                if (entity && entity.owner === playerId) {
                    unitsToProcess.push({ x, y, entity });
                }
            }
        }

        unitsToProcess.forEach(item => {
            const { x, y, entity } = item;
            if (gameState.grid[y][x] !== entity) return;

            if (entity.current_morale < constants.MORALE_THRESHOLD) {
                const fleeingProb = 1 - (entity.current_morale / constants.MORALE_THRESHOLD);
                if (Math.random() < fleeingProb) {
                    const wasFleeing = entity.is_fleeing;
                    entity.is_fleeing = true;
                    if (wasFleeing) io.emit('gameLog', { message: `! {u:${entity.type}:${x}:${y}:${entity.owner}} is still in panic and flees!` });
                    else io.emit('gameLog', { message: `! {u:${entity.type}:${x}:${y}:${entity.owner}} morale breaks! It starts fleeing!` });
                    handleFleeingMovement(entity, x, y);
                } else {
                    if (entity.is_fleeing) {
                        entity.is_fleeing = false;
                        io.emit('gameLog', { message: `* {u:${entity.type}:${x}:${y}:${entity.owner}} has regained control.` });
                    }
                }
            } else {
                if (entity.is_fleeing) {
                    entity.is_fleeing = false;
                    io.emit('gameLog', { message: `* {u:${entity.type}:${x}:${y}:${entity.owner}} has stopped fleeing.` });
                }
            }
        });
        updateAllUnitsMorale();
    }

    function handleFleeingMovement(entity, startX, startY) {
        entity.hasAttacked = true;
        entity.remainingMovement = 0;

        let queue = [{ x: startX, y: startY, path: [] }];
        let visited = new Set();
        visited.add(`${startX},${startY}`);
        let foundPath = null;

        while (queue.length > 0) {
            const { x, y, path } = queue.shift();
            if (x === 0 || x === constants.GRID_SIZE - 1 || y === 0 || y === constants.GRID_SIZE - 1) {
                foundPath = path;
                break;
            }
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (const [dx, dy] of dirs) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < constants.GRID_SIZE && ny >= 0 && ny < constants.GRID_SIZE) {
                    const key = `${nx},${ny}`;
                    // Fleeing units blocked by Impassable Terrain (cost > 10)
                    if (gameState.terrainMap[ny][nx].cost > 10) continue;

                    if (!visited.has(key) && !gameState.grid[ny][nx]) {
                        visited.add(key);
                        queue.push({ x: nx, y: ny, path: [...path, { x: nx, y: ny }] });
                    }
                }
            }
        }

        if (foundPath) {
            const stepsToTake = Math.min(foundPath.length, entity.speed);
            let finalPos = { x: startX, y: startY };

            for (let i = 0; i < stepsToTake; i++) {
                const nextStep = foundPath[i];
                const dx = nextStep.x - finalPos.x;
                const dy = nextStep.y - finalPos.y;
                if (dy > 0) entity.facing_direction = 4;
                else if (dy < 0) entity.facing_direction = 0;
                else if (dx > 0) entity.facing_direction = 2;
                else if (dx < 0) entity.facing_direction = 6;
                finalPos = nextStep;
            }

            gameState.grid[startY][startX] = null;
            if (finalPos.x === 0 || finalPos.x === constants.GRID_SIZE - 1 ||
                finalPos.y === 0 || finalPos.y === constants.GRID_SIZE - 1) {
                io.emit('combatResults', {
                    events: [{ x: finalPos.x, y: finalPos.y, type: 'death', value: '💨' }],
                    logs: [`-- {u:${entity.type}:${startX}:${startY}:${entity.owner}} fled the battlefield!`]
                });
            } else {
                gameState.grid[finalPos.y][finalPos.x] = entity;
            }
        } else {
            io.emit('gameLog', { message: `! {u:${entity.type}:${startX}:${startY}:${entity.owner}} is trapped and panicking!` });
        }
    }

    function endTurn() {
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = 0; u.hasAttacked = true; });
        const ids = Object.keys(gameState.players);
        const currentIndex = ids.indexOf(gameState.turn);
        const nextIndex = (currentIndex + 1) % ids.length;
        gameState.turn = ids[nextIndex];
        const nextPlayer = gameState.players[gameState.turn];
        modifyUnitsForPlayer(gameState.turn, (u) => { u.remainingMovement = u.speed; u.hasAttacked = false; });
        io.emit('gameLog', { message: `Turn changed to {p:${nextPlayer.name}}.` });
        handleMoralePhase(gameState.turn);
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