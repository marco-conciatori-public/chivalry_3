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

			player.gold -= baseStats.cost;

			gameState.grid[y][x] = {
				type: type,
				owner: socket.id,
				symbol: gameState.players[socket.id].symbol,
				remainingMovement: 0,
				hasAttacked: true,
				...baseStats,
				current_health: baseStats.max_health,
				current_morale: baseStats.initial_morale,
				facing_direction: 0
			};

			// Log with Tags
			io.emit('gameLog', { message: `{p:${player.name}} recruited a {u:${type}:${x}:${y}}.` });
			io.emit('update', gameState);
		}
	});

	socket.on('moveEntity', ({ from, to }) => {
		if (socket.id !== gameState.turn) return;

		const entity = gameState.grid[from.y][from.x];
		const targetCell = gameState.grid[to.y][to.x];

		if (entity && entity.owner === socket.id && !targetCell) {
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
				io.emit('update', gameState);
			}
		}
	});

	socket.on('rotateEntity', ({ x, y, direction }) => {
		if (socket.id !== gameState.turn) return;
		const entity = gameState.grid[y][x];
		if (entity && entity.owner === socket.id && entity.remainingMovement >= 1) {
			entity.facing_direction = direction;
			entity.remainingMovement -= 1;
			io.emit('update', gameState);
		}
	});

	socket.on('attackEntity', ({ attackerPos, targetPos }) => {
		if (socket.id !== gameState.turn) return;

		const attacker = gameState.grid[attackerPos.y][attackerPos.x];
		const target = gameState.grid[targetPos.y][targetPos.x];

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

				io.emit('update', gameState);
				io.emit('combatResults', combatResults);
			}
		}
	});

	function performCombat(attacker, attackerPos, defender, defenderPos, isRetaliation, combatResults) {
		// 1. Calculate and Apply Primary Damage
		const damage = calculateDamage(attacker, attackerPos, defender, defenderPos, false);

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
						combatResults.events.push({ x: pos.x, y: pos.y, type: 'damage', value: splashDamage, color: '#e67e22' }); // Orange for splash

						combatResults.logs.push(` -> Splash hit {u:${neighborUnit.type}:${pos.x}:${pos.y}} for ${splashDamage} damage.`);

						const splashKilled = applyDamage(neighborUnit, pos, splashDamage);
						if (splashKilled) {
							combatResults.events.push({ x: pos.x, y: pos.y, type: 'death', value: '💀' });
						}
					}
				}
			});
		}

		// 3. Retaliation Logic
		if (!isRetaliation && defender.current_health > 0 && defender.is_melee_capable) {
			const dist = Math.abs(attackerPos.x - defenderPos.x) + Math.abs(attackerPos.y - defenderPos.y);
			if (dist === 1) {
				combatResults.logs.push(`-- {u:${defender.type}:${defenderPos.x}:${defenderPos.y}} retaliates!`);
				performCombat(defender, defenderPos, attacker, attackerPos, true, combatResults);
			}
		}
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