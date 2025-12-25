const constants = require('./constants');

// --- PATHFINDING & LOS ---

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

                if (targetTerrain.cost > constants.MAP_GEN.IMPASSABLE_THRESHOLD) continue;
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

function hasLineOfSight(start, end, terrainMap) {
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
            if (terrainMap[y0][x0].blocksLos) {
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

// --- COMBAT LOGIC ---

function calculateDamage(attacker, attackerPos, defender, defenderPos, isSplash, terrainMap) {
    let bonusShield = 0;
    if (defender.has_shield) {
        const dx = attackerPos.x - defenderPos.x;
        const dy = attackerPos.y - defenderPos.y;
        let isShielded = false;
        if (defender.facing_direction === 0) { if (dy < 0 && dx === 0) isShielded = true; if (dx < 0 && dy === 0) isShielded = true; }
        if (defender.facing_direction === 2) { if (dx > 0 && dy === 0) isShielded = true; if (dy < 0 && dx === 0) isShielded = true; }
        if (defender.facing_direction === 4) { if (dy > 0 && dx === 0) isShielded = true; if (dx > 0 && dy === 0) isShielded = true; }
        if (defender.facing_direction === 6) { if (dx < 0 && dy === 0) isShielded = true; if (dy > 0 && dx === 0) isShielded = true; }

        if (isShielded) bonusShield = defender.shield_bonus || 0;
    }

    const tile = terrainMap[defenderPos.y][defenderPos.x];
    const terrainDefense = tile.defense || 0;

    let highGroundBonus = 0;
    const attackerTile = terrainMap[attackerPos.y][attackerPos.x];
    if (attackerTile.highGround) {
        highGroundBonus = 10;
    }

    let positionalBonus = 0;
    let chargeBonus = 0;
    let abilityBonus = 0;

    if (!attacker.is_ranged && !isSplash) {
        // 1. Positional Bonus
        const dx = attackerPos.x - defenderPos.x;
        const dy = attackerPos.y - defenderPos.y;
        const position = getRelativePosition(defender.facing_direction, dx, dy);

        if (position === 'FLANK') {
            positionalBonus = constants.BONUS_FLANK;
        } else if (position === 'REAR') {
            positionalBonus = constants.BONUS_REAR;
        }

        // 2. Charge Bonus (If moved this turn)
        // We assume if remainingMovement < speed, the unit has moved.
        if (attacker.remainingMovement < attacker.speed) {
            chargeBonus = attacker.charge_bonus || 0;
        }

        // 3. Ability Bonuses (e.g., Anti-Cavalry)
        if (attacker.special_abilities && attacker.special_abilities.includes('anti_cavalry')) {
            if (defender.type === 'light_cavalry' || defender.type === 'heavy_cavalry') {
                abilityBonus = constants.BONUS_ANTI_CAVALRY;
            }
        }
    }

    const healthFactor = constants.MIN_DAMAGE_REDUCTION_BY_HEALTH + ((attacker.current_health / attacker.max_health) * (1 - constants.MIN_DAMAGE_REDUCTION_BY_HEALTH));

    const defenseFactor = 1 - ((defender.defence + bonusShield + terrainDefense) / 100);
    const clampedDefenseFactor = Math.max(constants.MAX_DAMAGE_REDUCTION_BY_DEFENSE, defenseFactor);

    let baseDamage = (attacker.attack + highGroundBonus + positionalBonus + chargeBonus + abilityBonus) * healthFactor * clampedDefenseFactor;

    if (attacker.is_ranged) {
        if (isSplash) baseDamage *= ((100 - attacker.accuracy) / 100);
        else baseDamage *= (attacker.accuracy / 100);
    }

    const randomFactor = constants.DAMAGE_RANDOM_BASE + (Math.random() * constants.DAMAGE_RANDOM_VARIANCE);
    baseDamage *= randomFactor;

    return Math.floor(baseDamage);
}

function applyDamage(unit, pos, amount, grid) {
    unit.current_health -= amount;
    if (unit.current_health <= 0) {
        unit.current_health = 0;
        grid[pos.y][pos.x] = null;
        return true;
    }
    return false;
}

function performCombat(attacker, attackerPos, defender, defenderPos, isRetaliation, combatResults, gameState) {
    const damage = calculateDamage(attacker, attackerPos, defender, defenderPos, false, gameState.terrainMap);

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

    const killed = applyDamage(defender, defenderPos, damage, gameState.grid);

    if (killed) {
        combatResults.events.push({ x: defenderPos.x, y: defenderPos.y, type: 'death', value: '💀' });
        combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}:${defender.owner}} was destroyed!`);
        applyDeathMoraleEffects(defenderPos, defender.owner, gameState.grid);
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
                    const splashDamage = calculateDamage(attacker, attackerPos, neighborUnit, pos, true, gameState.terrainMap);
                    neighborUnit.raw_morale -= splashDamage;
                    combatResults.events.push({ x: pos.x, y: pos.y, type: 'damage', value: splashDamage, color: '#e67e22' });
                    combatResults.logs.push(` -> Splash hit {u:${neighborUnit.type}:${pos.x}:${pos.y}:${neighborUnit.owner}} for ${splashDamage} damage.`);

                    const splashKilled = applyDamage(neighborUnit, pos, splashDamage, gameState.grid);
                    if (splashKilled) {
                        combatResults.events.push({ x: pos.x, y: pos.y, type: 'death', value: '💀' });
                        applyDeathMoraleEffects(pos, neighborUnit.owner, gameState.grid);
                    }
                }
            }
        });
    }

    if (!isRetaliation && defender.current_health > 0 && defender.is_melee_capable) {
        const dist = Math.abs(attackerPos.x - defenderPos.x) + Math.abs(attackerPos.y - defenderPos.y);
        if (dist === 1) {
            combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}:${defender.owner}} retaliates!`);
            performCombat(defender, defenderPos, attacker, attackerPos, true, combatResults, gameState);
        }
    }
}

// --- MORALE LOGIC ---

function applyDeathMoraleEffects(pos, ownerId, grid) {
    const neighbors = [{x: pos.x, y: pos.y - 1}, {x: pos.x, y: pos.y + 1}, {x: pos.x - 1, y: pos.y}, {x: pos.x + 1, y: pos.y}];
    neighbors.forEach(n => {
        if (n.x >= 0 && n.x < constants.GRID_SIZE && n.y >= 0 && n.y < constants.GRID_SIZE) {
            const witness = grid[n.y][n.x];
            if (witness && !witness.is_fleeing) {
                if (witness.owner === ownerId) witness.raw_morale -= 10;
                else witness.raw_morale += 10;
            }
        }
    });
}

function calculateCurrentMorale(unit, x, y, grid) {
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
            const other = grid[ny][nx];
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
                const cUnit = grid[cy][cx];
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

function updateAllUnitsMorale(gameState) {
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            const entity = gameState.grid[y][x];
            if (entity) {
                calculateCurrentMorale(entity, x, y, gameState.grid);
            }
        }
    }
}

function handleMoralePhase(playerId, gameState, io) {
    updateAllUnitsMorale(gameState);
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
                handleFleeingMovement(entity, x, y, gameState, io);
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
    updateAllUnitsMorale(gameState);
}

function handleFleeingMovement(entity, startX, startY, gameState, io) {
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
                if (gameState.terrainMap[ny][nx].cost > constants.MAP_GEN.IMPASSABLE_THRESHOLD) continue;
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

module.exports = {
    getPathCost,
    hasLineOfSight,
    performCombat,
    handleMoralePhase,
    updateAllUnitsMorale
};