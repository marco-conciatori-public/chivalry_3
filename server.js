const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { unitStats, GAME_CONSTANTS } = require('./unitStats');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = {
	grid: Array(10).fill(null).map(() => Array(10).fill(null)),
	players: {},
	turn: null
};

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'];

io.on('connection', (socket) => {
	console.log('A player connected:', socket.id);

	const existingPlayers = Object.keys(gameState.players);
	const playerSymbol = existingPlayers.length === 0 ? 'X' : 'O';
	const playerColor = PLAYER_COLORS[existingPlayers.length % PLAYER_COLORS.length];

	gameState.players[socket.id] = {
		symbol: playerSymbol,
		color: playerColor,
		id: socket.id,
		gold: 2000
	};

	if (!gameState.turn) gameState.turn = socket.id;

	// SEND UNIT STATS to client for the UI
	socket.emit('init', {
		state: gameState,
		myId: socket.id,
		unitStats: unitStats
	});

	io.emit('update', gameState);

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
				// Spawn Constraints:
				remainingMovement: 0, // Cannot move turn 1
				hasAttacked: true,    // Cannot attack turn 1

				...baseStats,
				current_health: baseStats.max_health,
				current_morale: baseStats.max_morale,
				facing_direction: 0
			};
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
				// Update facing
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

		// Basic validation
		if (attacker && target && attacker.owner === socket.id && target.owner !== socket.id && !attacker.hasAttacked) {
			const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);

			if (dist <= attacker.range) {
				// Perform the main attack
				performCombat(attacker, attackerPos, target, targetPos, false);

				// Set attacker state
				attacker.hasAttacked = true;
				attacker.remainingMovement = 0;

				io.emit('update', gameState);
			}
		}
	});

	/**
	 * Calculates and applies damage between an attacker and a target.
	 * Handles Ranged splash damage and Melee retaliation.
	 * @param {Object} attacker - The attacking unit object
	 * @param {Object} attackerPos - {x, y}
	 * @param {Object} defender - The defending unit object
	 * @param {Object} defenderPos - {x, y}
	 * @param {Boolean} isRetaliation - True if this is a counter-attack
	 */
	function performCombat(attacker, attackerPos, defender, defenderPos, isRetaliation) {
		// 1. Calculate and Apply Primary Damage
		const damage = calculateDamage(attacker, attackerPos, defender, defenderPos, false);
		applyDamage(defender, defenderPos, damage);

		// 2. Ranged Splash Damage (Only on primary attack, not retaliation)
		if (attacker.is_ranged && !isRetaliation) {
			const neighbors = [
				{x: defenderPos.x, y: defenderPos.y - 1}, // N
				{x: defenderPos.x, y: defenderPos.y + 1}, // S
				{x: defenderPos.x - 1, y: defenderPos.y}, // W
				{x: defenderPos.x + 1, y: defenderPos.y}  // E
			];

			neighbors.forEach(pos => {
				if (pos.x >= 0 && pos.x < 10 && pos.y >= 0 && pos.y < 10) {
					const neighborUnit = gameState.grid[pos.y][pos.x];
					if (neighborUnit) {
						const splashDamage = calculateDamage(attacker, attackerPos, neighborUnit, pos, true);
						applyDamage(neighborUnit, pos, splashDamage);
					}
				}
			});
		}

		// 3. Retaliation Logic
		// Triggers if:
		// - Not a retaliation itself (prevent loops)
		// - Defender is still alive
		// - Defender is melee capable
		// - Attacker is adjacent
		if (!isRetaliation && defender.current_health > 0 && defender.is_melee_capable) {
			const dist = Math.abs(attackerPos.x - defenderPos.x) + Math.abs(attackerPos.y - defenderPos.y);
			if (dist === 1) {
				// Defender strikes back!
				performCombat(defender, defenderPos, attacker, attackerPos, true);
			}
		}
	}

	function calculateDamage(attacker, attackerPos, defender, defenderPos, isSplash) {
		// --- BONUS DAMAGE ---
		// Added if attacker has bonus_vs the defender type
		let bonusDamage = 0;
		if (attacker.bonus_vs && attacker.bonus_vs.includes(defender.type)) {
			bonusDamage = GAME_CONSTANTS.BONUS_DAMAGE;
		}

		// --- BONUS SHIELD ---
		// Added if defender has shield AND is facing the attacker
		let bonusShield = 0;
		if (defender.has_shield) {
			// Check facing
			// 0:N (y-1), 2:E (x+1), 4:S (y+1), 6:W (x-1)
			const dx = attackerPos.x - defenderPos.x;
			const dy = attackerPos.y - defenderPos.y;

			let isFacing = false;
			if (defender.facing_direction === 0 && dx === 0 && dy < 0) isFacing = true; // Attacker is North
			if (defender.facing_direction === 4 && dx === 0 && dy > 0) isFacing = true; // Attacker is South
			if (defender.facing_direction === 2 && dx > 0 && dy === 0) isFacing = true; // Attacker is East
			if (defender.facing_direction === 6 && dx < 0 && dy === 0) isFacing = true; // Attacker is West

			if (isFacing) {
				bonusShield = GAME_CONSTANTS.BONUS_SHIELD;
			}
		}

		// --- HEALTH PERCENTAGE FACTOR ---
		const healthPct = attacker.current_health / attacker.max_health;

		// --- DEFENSE FACTOR ---
		const defenseFactor = 1 - ((defender.defence + bonusShield) / 100);
		// Ensure defense doesn't heal (cap at 0 damage or cap max defense?)
		// Usually capped so defense < 100. If defense > 100, factor < 0 -> healing.
		// Let's clamp factor to min 0.
		const clampedDefenseFactor = Math.max(0.1, defenseFactor);

		let baseDamage = (attacker.attack + bonusDamage) * healthPct * clampedDefenseFactor;

		// --- RANGED / SPLASH MODIFIERS ---
		if (attacker.is_ranged) {
			if (isSplash) {
				// Splash Formula: uses (100 - accuracy)
				baseDamage *= ((100 - attacker.accuracy) / 100);
			} else {
				// Direct Hit Formula: uses accuracy
				baseDamage *= (attacker.accuracy / 100);
			}
		}

		return Math.floor(baseDamage);
	}

	function applyDamage(unit, pos, amount) {
		unit.current_health -= amount;
		if (unit.current_health <= 0) {
			unit.current_health = 0;
			gameState.grid[pos.y][pos.x] = null; // Destroy unit
		}
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
				if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
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

		modifyUnitsForPlayer(gameState.turn, (u) => {
			u.remainingMovement = u.speed;
			u.hasAttacked = false;
		});

		io.emit('update', gameState);
	}

	function modifyUnitsForPlayer(playerId, callback) {
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 10; x++) {
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