const unitStats = require('./unitStats');
const constants = require('./constants');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeTurn(gameState, playerId, gameLogic, actionCallbacks) {
    // 1. Identify my units
    let myUnits = [];
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            const u = gameState.grid[y][x];
            if (u && u.owner === playerId && !u.is_fleeing) {
                myUnits.push({ x, y, unit: u });
            }
        }
    }

    // 2. Identify Enemies
    let enemies = [];
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            const u = gameState.grid[y][x];
            if (u && u.owner !== playerId && !u.owner.startsWith('disconnected')) {
                enemies.push({ x, y, unit: u });
            }
        }
    }

    // Sort units: Commanders first, then by strength (expensive first)
    myUnits.sort((a, b) => {
        if (a.unit.is_commander) return -1;
        if (b.unit.is_commander) return 1;
        return (b.unit.cost || 0) - (a.unit.cost || 0);
    });

    // 3. Process Units
    for (const item of myUnits) {
        // Re-check position/existence in case it died/moved (unlikely in own turn but good practice)
        if (gameState.grid[item.y][item.x] !== item.unit) continue;

        const currentPos = { x: item.x, y: item.y };
        let hasMoved = false;

        // --- ATTACK CHECK (Pre-Move) ---
        let target = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic);

        if (target) {
            await sleep(500); // Visual delay
            actionCallbacks.attack({ x: currentPos.x, y: currentPos.y }, { x: target.x, y: target.y });
            // Attack ends turn for unit usually, unless melee kill
            if (item.unit.remainingMovement <= 0) continue;
        }

        // --- MOVE LOGIC ---
        // If we haven't attacked (or killed melee and can move), try to move closer
        if (item.unit.remainingMovement > 0 && !item.unit.hasAttacked) {
            // Find closest enemy
            const closest = findClosestEnemy(currentPos, enemies);

            if (closest) {
                // Determine ideal range: 1 for melee, max range for ranged
                const idealRange = item.unit.is_ranged ? (item.unit.range - 1) : 1;

                // Find path
                const path = gameLogic.findPath(currentPos, closest, gameState.grid, gameState.terrainMap);

                if (path && path.length > 0) {
                    // Calculate how far we can go
                    let steps = 0;
                    let cost = 0;

                    // Simple path traversal based on cost
                    // We need to re-verify cost because findPath heuristic assumes basic cost
                    // But getPathCost logic is robust.
                    // For "Easy" AI, we just take the first N steps that fit in movement

                    let targetStep = null;

                    // We don't want to step ON the enemy, stop at ideal range
                    // path includes the destination.
                    // If destination is enemy, we stop 1 tile before (for melee)
                    // But findPath excludes occupied tiles usually, so path might stop adjacent already

                    // Actually findPath in gameLogic DOES check collision, so it won't path ONTO an enemy.
                    // But it targets the enemy coord.
                    // Let's just pick the furthest reachable point on the path

                    // Re-calculate reachable with proper cost function
                    // Or iterate path and sum costs

                    let currentCost = 0;
                    let stepIndex = 0;
                    let lastValidPos = currentPos;

                    // Simple: Try to move as far along the path as possible
                    while(stepIndex < path.length) {
                        const nextPos = path[stepIndex];
                        const moveCost = gameLogic.getPathCost(lastValidPos, nextPos, gameState.grid, gameState.terrainMap, item.unit.remainingMovement - currentCost);

                        // Minimum movement rule handling is inside getPathCost now

                        if (moveCost !== -1 && (currentCost + moveCost) <= item.unit.remainingMovement) {
                            currentCost += moveCost;
                            lastValidPos = nextPos;
                            stepIndex++;
                        } else {
                            break;
                        }
                    }

                    if (lastValidPos.x !== currentPos.x || lastValidPos.y !== currentPos.y) {
                        await sleep(400);
                        actionCallbacks.move(currentPos, lastValidPos);
                        hasMoved = true;
                        currentPos.x = lastValidPos.x;
                        currentPos.y = lastValidPos.y;
                    }
                }
            }
        }

        // --- ATTACK CHECK (Post-Move) ---
        if (hasMoved && !item.unit.hasAttacked) {
            target = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic);
            if (target) {
                await sleep(400);
                actionCallbacks.attack({ x: currentPos.x, y: currentPos.y }, { x: target.x, y: target.y });
            }
        }

        // --- FACING LOGIC ---
        // If we moved but didn't attack, maybe rotate towards nearest enemy?
        // (Server handleMove already sets facing towards movement, so mostly fine)
    }

    // 4. Recruitment Logic
    const player = gameState.players[playerId];
    if (player.baseArea) {
        const types = ['light_infantry', 'archer', 'spearman', 'light_cavalry', 'heavy_infantry', 'heavy_cavalry', 'catapult'];

        // Try to spawn as many as possible
        let attempts = 0;
        while (player.gold >= 50 && attempts < 5) {
            attempts++;

            // Pick a random affordable unit
            // Filter types by cost
            const affordable = types.filter(t => unitStats[t].cost <= player.gold);
            if (affordable.length === 0) break;

            const typeToSpawn = affordable[Math.floor(Math.random() * affordable.length)];

            // Find empty spot in base
            let spawnSpot = null;
            for (let y = player.baseArea.y; y < player.baseArea.y + player.baseArea.height; y++) {
                for (let x = player.baseArea.x; x < player.baseArea.x + player.baseArea.width; x++) {
                    if (!gameState.grid[y][x]) {
                        const t = gameState.terrainMap[y][x];
                        if (t.id !== 'wall' && t.id !== 'water') {
                            spawnSpot = {x, y};
                            break;
                        }
                    }
                }
                if(spawnSpot) break;
            }

            if (spawnSpot) {
                await sleep(300);
                actionCallbacks.spawn(spawnSpot.x, spawnSpot.y, typeToSpawn);
            } else {
                break; // No room
            }
        }
    }

    // 5. End Turn
    await sleep(500);
    actionCallbacks.endTurn();
}

function findClosestEnemy(myPos, enemies) {
    let closest = null;
    let minDist = Infinity;

    enemies.forEach(e => {
        const dist = Math.abs(myPos.x - e.x) + Math.abs(myPos.y - e.y);
        if (dist < minDist) {
            minDist = dist;
            closest = { x: e.x, y: e.y };
        }
    });
    return closest;
}

function findBestTargetInRange(unit, myPos, enemies, gameState, gameLogic) {
    let bestTarget = null;
    let lowestHealth = Infinity;

    // Check height bonus for range
    const myTerrain = gameState.terrainMap[myPos.y][myPos.x];
    const rangeBonus = constants.BONUS_HIGH_GROUND_RANGE; // assuming 1 usually

    enemies.forEach(e => {
        const dist = Math.abs(myPos.x - e.x) + Math.abs(myPos.y - e.y);

        let effectiveRange = unit.range;
        if (unit.is_ranged && myTerrain.height > gameState.terrainMap[e.y][e.x].height) {
            effectiveRange += rangeBonus;
        }

        if (dist <= effectiveRange) {
            // Check LOS
            if (unit.is_ranged) {
                if (!gameLogic.hasLineOfSight(myPos, e, gameState.terrainMap)) return;
            }

            // Check Angle
            if (!gameLogic.isValidAttackAngle(unit, myPos, e)) return;

            // It's a valid target. Pick weak ones.
            if (e.unit.current_health < lowestHealth) {
                lowestHealth = e.unit.current_health;
                bestTarget = e;
            }
        }
    });

    return bestTarget;
}

module.exports = { executeTurn };