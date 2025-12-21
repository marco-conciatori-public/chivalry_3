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
	players: {},
	turn: null
};

io.on('connection', (socket) => {
	console.log('A player connected:', socket.id);

	const existingPlayers = Object.keys(gameState.players);
	const playerSymbol = existingPlayers.length === 0 ? 'X' : 'O';
	const playerColor = constants.PLAYER_COLORS[existingPlayers.length % constants.PLAYER_COLORS.length];

	// Assign a default name based on join order
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

	// SEND UNIT STATS to client for the UI
	socket.emit('init', {
		state: gameState,
		myId: socket.id,
		unitStats: unitStats
	});

	io.emit('update', gameState);

	// Handle Name Changes
	socket.on('changeName', (newName) => {
		const player = gameState.players[socket.id];
		if (player) {
			// Basic sanitization
			const cleanName = newName.trim().substring(0, 12) || player.name;
			player.name = cleanName;
			io.emit('update', gameState);
		}
	});

	socket.on('spawnEntity', ({ x, y, type }) => {
		if (socket.id !== gameState.turn) return;
		const player = gameState.players[socket.id];
		if (!player) return;

		if (!gameState.grid[y][x]) {
			const baseStats = unitStats[type];
			if (!baseStats) return;

			if (player.gold < baseStats.cost) return;

			// Check if this is the first unit for the player (Commander Logic)
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
				// raw_morale tracks persistent changes (damage, kills)
				raw_morale: baseStats.initial_morale,
				current_morale: baseStats.initial_morale,
				facing_direction: 0,
				is_commander: isCommander,
				is_fleeing: false,
				morale_breakdown: [] // Will be populated by updateAllUnitsMorale
			};

			// Log with Tags
			let msg = `{p:${player.name}} recruited a {u:${type}:${x}:${y}}`;
			if (isCommander) {
				msg += " as their Commander!";
			} else {
				msg += ".";
			}
			io.emit('gameLog', { message: msg });

			// Recalculate morale for everyone (adjacency changed)
			updateAllUnitsMorale();
			io.emit('update', gameState);
		}
	});

	socket.on('moveEntity', ({ from, to }) => {
		if (socket.id !== gameState.turn) return;

		const entity = gameState.grid[from.y][from.x];
		const targetCell = gameState.grid[to.y][to.x];

		if (entity && entity.owner === socket.id && !targetCell) {
			// Prevent controlling fleeing units
			if (entity.is_fleeing) {
				return;
			}

			const dist = getPathDistance(from, to, gameState.grid);

			if (dist > 0 && entity.remainingMovement >= dist) {
				const dx = to.x - from.x;
				const dy = to.y - from.y;
				if (Math.abs(dy) > Math.abs(dx)) {
					entity.facing_direction = dy > 0 ? 4 : 0;
				} else {
					entity.facing_direction = dx > 0 ? 2 : 6;
				}

				entity.remainingMovement -= dist;
				gameState.grid[to.y][to.x] = entity;
				gameState.grid[from.y][from.x] = null;

				// Recalculate morale for everyone (positions changed)
				updateAllUnitsMorale();
				io.emit('update', gameState);
			}
		}
	});

	socket.on('rotateEntity', ({ x, y, direction }) => {
		if (socket.id !== gameState.turn) return;
		const entity = gameState.grid[y][x];
		if (entity && entity.owner === socket.id && entity.remainingMovement >= 1) {
			if (entity.is_fleeing) return; // Cannot control fleeing units

			entity.facing_direction = direction;
			entity.remainingMovement -= 1;

			// Recalculate morale for everyone (facing changed, affects flanks/rear)
			updateAllUnitsMorale();
			io.emit('update', gameState);
		}
	});

	socket.on('attackEntity', ({ attackerPos, targetPos }) => {
		if (socket.id !== gameState.turn) return;

		const attacker = gameState.grid[attackerPos.y][attackerPos.x];
		const target = gameState.grid[targetPos.y][targetPos.x];

		if (attacker && attacker.is_fleeing) return; // Fleeing units cannot attack

		const combatResults = {
			events: [],
			logs: []
		};

		// Basic validation
		if (attacker && target && attacker.owner === socket.id && target.owner !== socket.id && !attacker.hasAttacked) {
			const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);

			if (dist <= attacker.range) {
				const attName = gameState.players[attacker.owner].name;
				const defName = gameState.players[target.owner].name;

				// Log with Tags
				combatResults.logs.push(`[{p:${attName}}] {u:${attacker.type}:${attackerPos.x}:${attackerPos.y}} attacks [{p:${defName}}] {u:${target.type}:${targetPos.x}:${targetPos.y}}!`);

				// Perform the main attack
				performCombat(attacker, attackerPos, target, targetPos, false, combatResults);

				// Set attacker state
				attacker.hasAttacked = true;
				attacker.remainingMovement = 0;

				// Update morale after combat
				updateAllUnitsMorale();
				io.emit('update', gameState);
				io.emit('combatResults', combatResults);
			}
		}
	});

	function performCombat(attacker, attackerPos, defender, defenderPos, isRetaliation, combatResults) {
		// 1. Calculate and Apply Primary Damage
		const damage = calculateDamage(attacker, attackerPos, defender, defenderPos, false);

		// --- MORALE CHANGE: Damage Taken ---
		// Damage taken reduces raw_morale by the same amount
		defender.raw_morale -= damage;

		// --- MORALE CHANGE: Damage Inflicted ---
		// Increases attacker raw_morale by half the amount (not for splash)
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

		combatResults.logs.push(` -> Dealt ${damage} damage to {u:${defender.type}:${defenderPos.x}:${defenderPos.y}}.`);

		const killed = applyDamage(defender, defenderPos, damage);

		if (killed) {
			combatResults.events.push({ x: defenderPos.x, y: defenderPos.y, type: 'death', value: '💀' });
			combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}} was destroyed!`);

			// --- MORALE CHANGE: Unit Destroyed (Adjacent) ---
			applyDeathMoraleEffects(defenderPos, defender.owner);
		}

		// 2. Ranged Splash Damage (Only on primary attack, not retaliation)
		if (attacker.is_ranged && !isRetaliation) {
			const neighbors = [
				{x: defenderPos.x, y: defenderPos.y - 1}, // N
				{x: defenderPos.x, y: defenderPos.y + 1}, // S
				{x: defenderPos.x - 1, y: defenderPos.y}, // W
				{x: defenderPos.x + 1, y: defenderPos.y}  // E
			];

			neighbors.forEach(pos => {
				if (pos.x >= 0 && pos.x < constants.GRID_SIZE && pos.y >= 0 && pos.y < constants.GRID_SIZE) {
					const neighborUnit = gameState.grid[pos.y][pos.x];
					if (neighborUnit) {
						const splashDamage = calculateDamage(attacker, attackerPos, neighborUnit, pos, true);

						// Splash damage also reduces morale of the victim
						neighborUnit.raw_morale -= splashDamage;

						combatResults.events.push({ x: pos.x, y: pos.y, type: 'damage', value: splashDamage, color: '#e67e22' }); // Orange for splash

						combatResults.logs.push(` -> Splash hit {u:${neighborUnit.type}:${pos.x}:${pos.y}} for ${splashDamage} damage.`);

						const splashKilled = applyDamage(neighborUnit, pos, splashDamage);
						if (splashKilled) {
							combatResults.events.push({ x: pos.x, y: pos.y, type: 'death', value: '💀' });
							// --- MORALE CHANGE: Unit Destroyed (Adjacent) for splash victim ---
							applyDeathMoraleEffects(pos, neighborUnit.owner);
						}
					}
				}
			});
		}

		// 3. Retaliation Logic
		// Note: Fleeing units CAN retaliate if attacked
		if (!isRetaliation && defender.current_health > 0 && defender.is_melee_capable) {
			const dist = Math.abs(attackerPos.x - defenderPos.x) + Math.abs(attackerPos.y - defenderPos.y);
			if (dist === 1) {
				combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}} retaliates!`);
				performCombat(defender, defenderPos, attacker, attackerPos, true, combatResults);
			}
		}
	}

	function applyDeathMoraleEffects(pos, ownerId) {
		// Check all adjacent units
		const neighbors = [
			{x: pos.x, y: pos.y - 1},
			{x: pos.x, y: pos.y + 1},
			{x: pos.x - 1, y: pos.y},
			{x: pos.x + 1, y: pos.y}
		];

		neighbors.forEach(n => {
			if (n.x >= 0 && n.x < constants.GRID_SIZE && n.y >= 0 && n.y < constants.GRID_SIZE) {
				const witness = gameState.grid[n.y][n.x];
				if (witness && !witness.is_fleeing) {
					if (witness.owner === ownerId) {
						// Adjacent ALLY destroyed
						witness.raw_morale -= 10;
					} else {
						// Adjacent ENEMY destroyed
						witness.raw_morale += 10;
					}
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
			if (defender.facing_direction === 0) {
				if (dy < 0 && dx === 0) isShielded = true;
				if (dx < 0 && dy === 0) isShielded = true;
			}
			if (defender.facing_direction === 2) {
				if (dx > 0 && dy === 0) isShielded = true;
				if (dy < 0 && dx === 0) isShielded = true;
			}
			if (defender.facing_direction === 4) {
				if (dy > 0 && dx === 0) isShielded = true;
				if (dx > 0 && dy === 0) isShielded = true;
			}
			if (defender.facing_direction === 6) {
				if (dx < 0 && dy === 0) isShielded = true;
				if (dy > 0 && dx === 0) isShielded = true;
			}

			if (isShielded) {
				bonusShield = constants.BONUS_SHIELD;
			}
		}

		const healthFactor = constants.MIN_DAMAGE_REDUCTION_BY_HEALTH + ((attacker.current_health / attacker.max_health) * (1 - constants.MIN_DAMAGE_REDUCTION_BY_HEALTH));
		const defenseFactor = 1 - ((defender.defence + bonusShield) / 100);
		const clampedDefenseFactor = Math.max(constants.MAX_DAMAGE_REDUCTION_BY_DEFENSE, defenseFactor);

		let baseDamage = (attacker.attack + bonusDamage) * healthFactor * clampedDefenseFactor;

		if (attacker.is_ranged) {
			if (isSplash) {
				baseDamage *= ((100 - attacker.accuracy) / 100);
			} else {
				baseDamage *= (attacker.accuracy / 100);
			}
		}

		const randomFactor = constants.DAMAGE_RANDOM_BASE + (Math.random() * constants.DAMAGE_RANDOM_VARIANCE);
		baseDamage *= randomFactor;

		return Math.floor(baseDamage);
	}

	function applyDamage(unit, pos, amount) {
		unit.current_health -= amount;
		if (unit.current_health <= 0) {
			unit.current_health = 0;
			gameState.grid[pos.y][pos.x] = null; // Destroy unit
			return true; // Killed
		}
		return false; // Survived
	}

	socket.on('endTurn', () => {
		if (socket.id !== gameState.turn) return;
		endTurn();
	});

	function getPathDistance(start, end, grid) {
		if (start.x === end.x && start.y === end.y) return 0;
		let queue = [{x: start.x, y: start.y, dist: 0}];
		let visited = new Set();
		visited.add(`${start.x},${start.y}`);
		while (queue.length > 0) {
			const {x, y, dist} = queue.shift();
			if (x === end.x && y === end.y) return dist;
			const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
			for (const [dx, dy] of dirs) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx >= 0 && nx < constants.GRID_SIZE && ny >= 0 && ny < constants.GRID_SIZE) {
					const key = `${nx},${ny}`;
					if (!visited.has(key)) {
						const isTarget = (nx === end.x && ny === end.y);
						if (isTarget || !grid[ny][nx]) {
							visited.add(key);
							queue.push({x: nx, y: ny, dist: dist + 1});
						}
					}
				}
			}
		}
		return -1;
	}

	// --- MORALE CALCULATIONS ---

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
		// Breakdown Array for Client Tooltip
		let breakdown = [];

		// 1. Start with Persistent Morale (Initial - Damage + Kills/Witness)
		if (unit.raw_morale > constants.MAX_MORALE) unit.raw_morale = constants.MAX_MORALE;

		let morale = unit.raw_morale;

		breakdown.push({ label: "Base Stats", value: unit.initial_morale });

		// Show diff between Raw and Initial as "Battle Events"
		const eventDiff = unit.raw_morale - unit.initial_morale;
		if (eventDiff !== 0) {
			breakdown.push({ label: "Battle Events", value: eventDiff });
		}

		// 2. Position Modifiers
		let adjacentAllies = 0;
		let adjacentEnemies = 0;
		let flankingEnemies = 0;
		let rearEnemies = 0;

		const neighbors = [
			{dx: 0, dy: -1}, // N
			{dx: 0, dy: 1},  // S
			{dx: -1, dy: 0}, // W
			{dx: 1, dy: 0}   // E
		];

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

						// Check Flanking/Rear
						// Helper to determine relation based on unit.facing_direction
						// 0=N, 2=E, 4=S, 6=W
						const relation = getRelativePosition(unit.facing_direction, dx, dy);
						if (relation === 'FLANK') flankingEnemies++;
						if (relation === 'REAR') rearEnemies++;
					}
				}
			}
		});

		if (adjacentAllies > 0) {
			const val = adjacentAllies * 10;
			morale += val;
			breakdown.push({ label: "Adj. Allies", value: val });
		}

		if (adjacentEnemies > 1) {
			const val = -((adjacentEnemies - 1) * 10);
			morale += val;
			breakdown.push({ label: "Swarmed", value: val });
		}

		if (flankingEnemies > 0) {
			const val = -(flankingEnemies * 10);
			morale += val;
			breakdown.push({ label: "Flanked", value: val });
		}

		if (rearEnemies > 0) {
			const val = -(rearEnemies * 20);
			morale += val;
			breakdown.push({ label: "Rear Att.", value: val });
		}

		// Commander Bonuses
		if (unit.is_commander) {
			morale += 20;
			breakdown.push({ label: "Commander", value: 20 });
		}

		// Allied Commander nearby?
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
			if (commanderNearby) {
				morale += 10;
				breakdown.push({ label: "Cmdr Aura", value: 10 });
			}
		}

		// Cap at MAX_MORALE
		if (morale > constants.MAX_MORALE) morale = constants.MAX_MORALE;

		unit.current_morale = morale;
		unit.morale_breakdown = breakdown;
	}

	function getRelativePosition(facing, dx, dy) {
		// facing: 0=N (dy=-1), 2=E (dx=1), 4=S (dy=1), 6=W (dx=-1)

		// REAR CHECK
		if (facing === 0 && dy === 1 && dx === 0) return 'REAR';
		if (facing === 2 && dx === -1 && dy === 0) return 'REAR';
		if (facing === 4 && dy === -1 && dx === 0) return 'REAR';
		if (facing === 6 && dx === 1 && dy === 0) return 'REAR';

		// FLANK CHECK (Sides)
		if (facing === 0 && dy === 0) return 'FLANK'; // Left/Right for North
		if (facing === 4 && dy === 0) return 'FLANK'; // Left/Right for South
		if (facing === 2 && dx === 0) return 'FLANK'; // Top/Bottom for East
		if (facing === 6 && dx === 0) return 'FLANK'; // Top/Bottom for West

		return 'FRONT';
	}

	// --- MORALE & FLEEING LOGIC ---

	function handleMoralePhase(playerId) {
		// Ensure calculations are up to date before checking
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

			// 1. Check Morale Threshold
			if (entity.current_morale < constants.MORALE_THRESHOLD) {
				const fleeingProb = 1 - (entity.current_morale / constants.MORALE_THRESHOLD);
				const roll = Math.random();

				if (roll < fleeingProb) {
					// Unit IS fleeing (either starts or continues)
					const wasFleeing = entity.is_fleeing;
					entity.is_fleeing = true;

					if (wasFleeing) {
						io.emit('gameLog', { message: `! {u:${entity.type}:${x}:${y}} is still in panic and flees!` });
					} else {
						io.emit('gameLog', { message: `! {u:${entity.type}:${x}:${y}} morale breaks! It starts fleeing!` });
					}

					handleFleeingMovement(entity, x, y);

				} else {
					// Unit passes check
					if (entity.is_fleeing) {
						entity.is_fleeing = false;
						io.emit('gameLog', { message: `* {u:${entity.type}:${x}:${y}} has regained control.` });
					}
				}
			} else {
				// Morale is fine
				if (entity.is_fleeing) {
					entity.is_fleeing = false;
					io.emit('gameLog', { message: `* {u:${entity.type}:${x}:${y}} has stopped fleeing.` });
				}
			}
		});

		// Recalculate again after fleeing movements
		updateAllUnitsMorale();
	}

	function handleFleeingMovement(entity, startX, startY) {
		// Unit cannot attack
		entity.hasAttacked = true;
		entity.remainingMovement = 0; // Will be set to 0 after move to prevent player control

		// BFS to find shortest path to ANY border cell
		let queue = [{ x: startX, y: startY, path: [] }];
		let visited = new Set();
		visited.add(`${startX},${startY}`);

		let foundPath = null;

		while (queue.length > 0) {
			const { x, y, path } = queue.shift();

			// Check if we reached a border
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
					// Can only move into empty cells
					if (!visited.has(key) && !gameState.grid[ny][nx]) {
						visited.add(key);
						queue.push({ x: nx, y: ny, path: [...path, { x: nx, y: ny }] });
					}
				}
			}
		}

		if (foundPath) {
			// Determine how far we can move along this path
			const stepsToTake = Math.min(foundPath.length, entity.speed);
			let finalPos = { x: startX, y: startY };

			for (let i = 0; i < stepsToTake; i++) {
				const nextStep = foundPath[i];

				// Update facing based on move direction
				const dx = nextStep.x - finalPos.x;
				const dy = nextStep.y - finalPos.y;

				if (dy > 0) entity.facing_direction = 4;
				else if (dy < 0) entity.facing_direction = 0;
				else if (dx > 0) entity.facing_direction = 2;
				else if (dx < 0) entity.facing_direction = 6;

				finalPos = nextStep;
			}

			// Remove from old position
			gameState.grid[startY][startX] = null;

			// Check if the final position is a border (Escaped)
			// Note: If we started at border, foundPath is empty, finalPos is startPos -> Escaped.
			if (finalPos.x === 0 || finalPos.x === constants.GRID_SIZE - 1 ||
				finalPos.y === 0 || finalPos.y === constants.GRID_SIZE - 1) {

				io.emit('combatResults', {
					events: [{ x: finalPos.x, y: finalPos.y, type: 'death', value: '💨' }],
					logs: [`-- {u:${entity.type}:${startX}:${startY}} fled the battlefield!`]
				});
				// Entity is gone (grid is null)
			} else {
				// Move to new position
				gameState.grid[finalPos.y][finalPos.x] = entity;
			}
		} else {
			// No path to border found (Trapped)
			io.emit('gameLog', { message: `! {u:${entity.type}:${startX}:${startY}} is trapped and panicking!` });
		}
	}

	function endTurn() {
		modifyUnitsForPlayer(gameState.turn, (u) => {
			u.remainingMovement = 0;
			u.hasAttacked = true;
		});

		const ids = Object.keys(gameState.players);
		const currentIndex = ids.indexOf(gameState.turn);
		const nextIndex = (currentIndex + 1) % ids.length;
		gameState.turn = ids[nextIndex];
		const nextPlayer = gameState.players[gameState.turn];

		modifyUnitsForPlayer(gameState.turn, (u) => {
			u.remainingMovement = u.speed;
			u.hasAttacked = false;
		});

		io.emit('gameLog', { message: `Turn changed to {p:${nextPlayer.name}}.` });

		// Start of Turn Morale Phase
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
				modifyUnitsForPlayer(gameState.turn, (u) => {
					u.remainingMovement = u.speed;
					u.hasAttacked = false;
				});
			}
		}
		io.emit('update', gameState);
	});
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));