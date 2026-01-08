const unitStats = require('./unitStats');
const constants = require('./constants');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper: Determine direction from A to B
function getDirection(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dy) > Math.abs(dx)) {
        return dy > 0 ? 4 : 0; // Down : Up
    } else {
        return dx > 0 ? 2 : 6; // Right : Left
    }
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

        // --- PHASE 1: PRE-MOVE ACTION ---
        // A. Try Strict Attack (Correct Range & Angle)
        let target = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic, false);

        if (target) {
            await sleep(500);
            actionCallbacks.attack({ x: currentPos.x, y: currentPos.y }, { x: target.x, y: target.y });
            if (item.unit.remainingMovement <= 0) continue;
        }
        // B. Try Rotation Attack (Correct Range, Wrong Angle)
        else if (item.unit.remainingMovement >= 1 && !item.unit.hasAttacked) {
            const potentialTarget = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic, true); // ignoreAngle = true
            if (potentialTarget) {
                // Check if we need to rotate
                if (!gameLogic.isValidAttackAngle(item.unit, currentPos, potentialTarget)) {
                    const neededDir = getDirection(currentPos, potentialTarget);
                    if (item.unit.facing_direction !== neededDir) {
                        await sleep(300);
                        actionCallbacks.rotate(currentPos.x, currentPos.y, neededDir);
                        // Try attack again now that we rotated
                        await sleep(300);
                        actionCallbacks.attack(currentPos, { x: potentialTarget.x, y: potentialTarget.y });
                        if (item.unit.remainingMovement <= 0) continue;
                    }
                }
            }
        }

        // --- PHASE 2: MOVEMENT ---
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
                    let currentCost = 0;
                    let stepIndex = 0;
                    let lastValidPos = currentPos;

                    // Simple: Try to move as far along the path as possible
                    while(stepIndex < path.length) {
                        const nextPos = path[stepIndex];
                        const moveCost = gameLogic.getPathCost(lastValidPos, nextPos, gameState.grid, gameState.terrainMap, item.unit.remainingMovement - currentCost);

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

        // --- PHASE 3: POST-MOVE ACTION ---
        if (!item.unit.hasAttacked) {
            // A. Strict Attack
            target = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic, false);
            if (target) {
                await sleep(400);
                actionCallbacks.attack({ x: currentPos.x, y: currentPos.y }, { x: target.x, y: target.y });
            }
            // B. Rotate Attack (if we still have movement)
            else if (item.unit.remainingMovement >= 1) {
                const potentialTarget = findBestTargetInRange(item.unit, currentPos, enemies, gameState, gameLogic, true);
                if (potentialTarget) {
                    const neededDir = getDirection(currentPos, potentialTarget);
                    if (!gameLogic.isValidAttackAngle(item.unit, currentPos, potentialTarget)) {
                        await sleep(300);
                        actionCallbacks.rotate(currentPos.x, currentPos.y, neededDir);
                        await sleep(300);
                        actionCallbacks.attack(currentPos, { x: potentialTarget.x, y: potentialTarget.y });
                    }
                }
            }
        }

        // --- PHASE 4: DEFENSIVE FACING ---
        // If we ended the turn with movement left and didn't attack, face the nearest enemy
        if (!item.unit.hasAttacked && item.unit.remainingMovement >= 1) {
            const closest = findClosestEnemy(currentPos, enemies);
            if (closest) {
                const neededDir = getDirection(currentPos, closest);
                if (item.unit.facing_direction !== neededDir) {
                    await sleep(200);
                    actionCallbacks.rotate(currentPos.x, currentPos.y, neededDir);
                }
            }
        }
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

function findBestTargetInRange(unit, myPos, enemies, gameState, gameLogic, ignoreAngle = false) {
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

            // Check Angle (unless ignored)
            if (!ignoreAngle && !gameLogic.isValidAttackAngle(unit, myPos, e)) return;

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