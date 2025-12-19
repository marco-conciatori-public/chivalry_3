const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const unitStats = require('./unitStats'); // Import the new stats file

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Basic Game State
let gameState = {
	grid: Array(10).fill(null).map(() => Array(10).fill(null)),
	players: {}, // Store player info by socket ID
	turn: null   // ID of the player whose turn it is
};

// Fixed color palette for players
const PLAYER_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'];

io.on('connection', (socket) => {
	console.log('A player connected:', socket.id);

	// Assign player a symbol (X or O) and a color
	const existingPlayers = Object.keys(gameState.players);
	const playerSymbol = existingPlayers.length === 0 ? 'X' : 'O';
	// cycle through colors based on number of players
	const playerColor = PLAYER_COLORS[existingPlayers.length % PLAYER_COLORS.length];

	gameState.players[socket.id] = {
		symbol: playerSymbol,
		color: playerColor,
		id: socket.id
	};

	// Set first player as the starting turn
	if (!gameState.turn) gameState.turn = socket.id;

	// Send initial state to the new player
	socket.emit('init', { state: gameState, myId: socket.id });

	// Broadcast update to everyone
	io.emit('update', gameState);

	socket.on('spawnEntity', ({ x, y, type }) => {
		if (socket.id !== gameState.turn) return;

		// Check if cell is empty
		if (!gameState.grid[y][x]) {
			// Get base stats from the configuration file
			const baseStats = unitStats[type];
			if (!baseStats) return; // Guard against invalid types

			gameState.grid[y][x] = {
				type: type,
				owner: socket.id,
				symbol: gameState.players[socket.id].symbol,
				hasMoved: true, // Spawned units can't move same turn

				// Spread the static stats (attack, defence, etc.)
				...baseStats,

				// Initialize dynamic variables
				current_health: baseStats.max_health,
				current_morale: baseStats.max_morale,
				facing_direction: 0 // 0: North, 2: East, 4: South, 6: West
			};

			io.emit('update', gameState);
		}
	});

	socket.on('moveEntity', ({ from, to }) => {
		if (socket.id !== gameState.turn) return;

		const entity = gameState.grid[from.y][from.x];

		// Validate owner, hasn't moved, target is empty
		if (entity &&
			entity.owner === socket.id &&
			!entity.hasMoved &&
			!gameState.grid[to.y][to.x] &&
			isReachable(from, to, entity.speed, gameState.grid) // Valid path check
		) {
			// Update facing direction based on movement (last step logic roughly)
			const dx = to.x - from.x;
			const dy = to.y - from.y;

			// Simple direction logic based on overall displacement
			// (Note: With pathfinding, this might be better calculated by the first step,
			// but simplified here to facing the destination)
			if (Math.abs(dy) > Math.abs(dx)) {
				entity.facing_direction = dy > 0 ? 4 : 0; // South or North
			} else {
				entity.facing_direction = dx > 0 ? 2 : 6; // East or West
			}

			// Update location
			gameState.grid[to.y][to.x] = entity;
			gameState.grid[from.y][from.x] = null;

			// Mark as moved
			gameState.grid[to.y][to.x].hasMoved = true;

			io.emit('update', gameState);
		}
	});

	// Manual End Turn
	socket.on('endTurn', () => {
		if (socket.id !== gameState.turn) return;
		endTurn();
	});

	// PATHFINDING (BFS)
	// Checks if 'end' is reachable from 'start' within 'speed' steps on the grid
	function isReachable(start, end, speed, grid) {
		if (start.x === end.x && start.y === end.y) return false; // Moving to same spot is invalid action

		let queue = [{x: start.x, y: start.y, dist: 0}];
		let visited = new Set();
		visited.add(`${start.x},${start.y}`);

		while (queue.length > 0) {
			const {x, y, dist} = queue.shift();

			// Found target?
			if (x === end.x && y === end.y) return true;

			// Stop if we reached max speed range
			if (dist >= speed) continue;

			const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
			for (const [dx, dy] of dirs) {
				const nx = x + dx;
				const ny = y + dy;

				// Boundary check
				if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
					const key = `${nx},${ny}`;
					if (!visited.has(key)) {
						const isTarget = (nx === end.x && ny === end.y);
						// We can only walk into empty cells or the target cell
						// (Target cell must be empty for move, but isReachable just checks path connectivity)
						if (isTarget || !grid[ny][nx]) {
							visited.add(key);
							queue.push({x: nx, y: ny, dist: dist + 1});
						}
					}
				}
			}
		}
		return false;
	}

	function endTurn() {
		// Exhaust (gray out) all units for the player who is ending their turn
		exhaustUnitsForPlayer(gameState.turn);

		const ids = Object.keys(gameState.players);
		// Simple round-robin turn logic
		const currentIndex = ids.indexOf(gameState.turn);
		const nextIndex = (currentIndex + 1) % ids.length;
		gameState.turn = ids[nextIndex];

		// RESET MOVES for the new active player
		resetMovesForPlayer(gameState.turn);

		io.emit('update', gameState);
	}

	function exhaustUnitsForPlayer(playerId) {
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 10; x++) {
				const entity = gameState.grid[y][x];
				if (entity && entity.owner === playerId) {
					entity.hasMoved = true;
				}
			}
		}
	}

	function resetMovesForPlayer(playerId) {
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 10; x++) {
				const entity = gameState.grid[y][x];
				if (entity && entity.owner === playerId) {
					entity.hasMoved = false;
				}
			}
		}
	}

	socket.on('disconnect', () => {
		delete gameState.players[socket.id];
		// If the active player left, reset turn
		if (gameState.turn === socket.id) {
			const ids = Object.keys(gameState.players);
			gameState.turn = ids.length > 0 ? ids[0] : null;
			if(gameState.turn) resetMovesForPlayer(gameState.turn);
		}
		console.log('Player disconnected');
		io.emit('update', gameState);
	});
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));