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

				// Spread the static stats (attack, defense, etc.)
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

		// Validate owner, adjacency, and IF IT HAS MOVED
		if (entity && entity.owner === socket.id && !entity.hasMoved && isAdjacent(from, to) && !gameState.grid[to.y][to.x]) {
			// Update facing direction based on movement
			const dx = to.x - from.x;
			const dy = to.y - from.y;

			// Simple 4-way direction logic for now (0:N, 2:E, 4:S, 6:W)
			// You can expand this to 8-way (0-7) if you allow diagonal movement later
			if (dy === -1) entity.facing_direction = 0; // North
			if (dy === 1)  entity.facing_direction = 4; // South
			if (dx === 1)  entity.facing_direction = 2; // East
			if (dx === -1) entity.facing_direction = 6; // West

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

	function isAdjacent(p1, p2) {
		const dx = Math.abs(p1.x - p2.x);
		const dy = Math.abs(p1.y - p2.y);
		return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
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