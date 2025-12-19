const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats');

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
		id: socket.id
	};

	if (!gameState.turn) gameState.turn = socket.id;

	socket.emit('init', { state: gameState, myId: socket.id });
	io.emit('update', gameState);

	socket.on('spawnEntity', ({ x, y, type }) => {
		if (socket.id !== gameState.turn) return;

		if (!gameState.grid[y][x]) {
			const baseStats = unitStats[type];
			if (!baseStats) return;

			gameState.grid[y][x] = {
				type: type,
				owner: socket.id,
				symbol: gameState.players[socket.id].symbol,
				remainingMovement: 0,
				hasAttacked: false, // Track attack state

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
		// Cost: 1 movement
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

		if (attacker && target && attacker.owner === socket.id && target.owner !== socket.id && !attacker.hasAttacked) {
			// Check range (Manhattan distance for simplicity in grid)
			// or Chebyshev if diagonals allowed. Let's use simple abs diff max for range.
			const dist = Math.abs(attackerPos.x - targetPos.x) + Math.abs(attackerPos.y - targetPos.y);

			// Allow attack?
			if (dist <= attacker.range) {
				// Calculate Damage
				let damage = Math.max(0, attacker.attack - target.defence);

				// Bonus Vs
				if (attacker.bonus_vs.includes(target.type)) {
					damage = Math.floor(damage * 1.5);
				}

				// Accuracy Check
				const hit = Math.random() * 100 <= attacker.accuracy;

				// Melee units always hit if adjacent? Or just rely on accuracy?
				// Let's rely on accuracy stat.
				if (hit || attacker.accuracy === 0) { // 0 accuracy usually means always hit in some systems, or use 100 for always.
					// Actually unitStats used 0 for knight/scout. Let's assume 0 means "Standard Melee Hit" (100%) or logic error in stats.
					// Assuming 0 means 100 for melee in this context or fixing stats.
					// Let's assume stats provided: Knight Accuracy 0.
					// I will treat accuracy 0 as 100% for now to make game playable.
					target.current_health -= damage;
				} else {
					// Miss
				}

				attacker.hasAttacked = true;
				// Attack consumes all movement? Or specific cost?
				// Usually attacking ends movement in these games.
				attacker.remainingMovement = 0;

				// Check Death
				if (target.current_health <= 0) {
					gameState.grid[targetPos.y][targetPos.x] = null;
				}

				io.emit('update', gameState);
			}
		}
	});

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