const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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

io.on('connection', (socket) => {
    console.log('A player connected:', socket.id);

    // Assign player a symbol (X or O) and add to state
    const playerSymbol = Object.keys(gameState.players).length === 0 ? 'X' : 'O';
    gameState.players[socket.id] = { symbol: playerSymbol };

    // Set first player as the starting turn
    if (!gameState.turn) gameState.turn = socket.id;

    // Send initial state to the new player
    socket.emit('init', { state: gameState, myId: socket.id });

	socket.on('spawnEntity', ({ x, y, type }) => {
		if (socket.id !== gameState.turn) return;
		
		// Check if cell is empty
		if (!gameState.grid[y][x]) {
			gameState.grid[y][x] = {
				type: type,
				owner: socket.id,
				symbol: gameState.players[socket.id].symbol
			};
			endTurn();
		}
	});

	socket.on('moveEntity', ({ from, to }) => {
		if (socket.id !== gameState.turn) return;

		const entity = gameState.grid[from.y][from.x];
		
		// Validate owner and adjacency
		if (entity && entity.owner === socket.id && isAdjacent(from, to) && !gameState.grid[to.y][to.x]) {
			gameState.grid[to.y][to.x] = entity;
			gameState.grid[from.y][from.x] = null;
			endTurn();
		}
	});

	function isAdjacent(p1, p2) {
		const dx = Math.abs(p1.x - p2.x);
		const dy = Math.abs(p1.y - p2.y);
		return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
	}

	function endTurn() {
		const ids = Object.keys(gameState.players);
		gameState.turn = ids.find(id => id !== gameState.turn) || ids[0];
		io.emit('update', gameState);
	}

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        if (gameState.turn === socket.id) gameState.turn = null;
        console.log('Player disconnected');
    });
});

server.listen(3000, () => console.log('Server running on http://localhost:3000'));