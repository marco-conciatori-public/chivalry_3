const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats'); // Import the stats

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Basic Game State
let gameState = {
	grid: Array(10).fill(null).map(() => Array(10).fill(null)),
	players: {},
	turn: null
};

const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'];

io.on('connection', (socket) => {
	console.log('A player connected:', socket.id);

	// Assign player
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
				// NEW: Use remainingMovement logic
				remainingMovement: 0, // Exhausted on spawn

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

		// Basic validation
		if (entity && entity.owner === socket.id && !targetCell) {

			// Calculate true path distance avoiding obstacles
			const dist = getPathDistance(from, to, gameState.grid);

			// Check if valid path exists and unit has enough movement
			if (dist > 0 && entity.remainingMovement >= dist) {

				// Update facing direction
				const dx = to.x - from.x;
				const dy = to.y - from.y;
				if (Math.abs(dy) > Math.abs(dx)) {
					entity.facing_direction = dy > 0 ? 4 : 0; // South : North
				} else {
					entity.facing_direction = dx > 0 ? 2 : 6; // East : West
				}

				// Deduct movement cost
				entity.remainingMovement -= dist;

				// Move unit
				gameState.grid[to.y][to.x] = entity;
				gameState.grid[from.y][from.x] = null;

				io.emit('update', gameState);
			}
		}
	});

	socket.on('endTurn', () => {
		if (socket.id !== gameState.turn) return;
		endTurn();
	});

	// BFS to find shortest path distance (returns -1 if unreachable)
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
					// We can traverse if empty OR if it's the specific target cell
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
		return -1; // Unreachable
	}

	function endTurn() {
		// 1. Exhaust current player's units (set movement to 0)
		modifyUnitsForPlayer(gameState.turn, (u) => {
			u.remainingMovement = 0;
		});

		const ids = Object.keys(gameState.players);
		const currentIndex = ids.indexOf(gameState.turn);
		const nextIndex = (currentIndex + 1) % ids.length;
		gameState.turn = ids[nextIndex];

		// 2. Refill movement for the NEW player
		modifyUnitsForPlayer(gameState.turn, (u) => {
			// lookup max speed from stats or the unit itself if we stored it
			u.remainingMovement = u.speed;
		});

		io.emit('update', gameState);
	}

	// Helper to apply a function to all units of a specific player
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
			// If turn passed due to disconnect, reset the new player's moves
			if(gameState.turn) {
				modifyUnitsForPlayer(gameState.turn, (u) => u.remainingMovement = u.speed);
			}
		}
		console.log('Player disconnected');
		io.emit('update', gameState);
	});
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));