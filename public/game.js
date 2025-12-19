const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const playerListElement = document.getElementById('player-list');
const connectionStatus = document.getElementById('connection-status');

const GRID_SIZE = 10;
const CELL_SIZE = canvas.width / GRID_SIZE;
const icons = {
    knight: '⚔️',
    archer: '🏹',
    wizard: '🧙',
    scout: '🏇'
};

let myId = null;
let localState = null;
let selectedCell = null; // {x, y}
let selectedTemplate = null; // 'knight', etc.

socket.on('init', (data) => {
    myId = data.myId;
    localState = data.state;
    connectionStatus.innerText = `Connected as ID: ${myId.substr(0,4)}...`;
    render();
    updateLegend();
});

socket.on('update', (state) => {
    localState = state;
    render();
    updateLegend();
});

// DESELECT: Add Escape key handler
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        deselectAll();
        render();
    }
});

function deselectAll() {
    selectedCell = null;
    selectedTemplate = null;
    document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
}

// Select a template from the UI
document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        // If clicking the same one, toggle it off
        if (selectedTemplate === el.dataset.type) {
            deselectAll();
        } else {
            // Deselect any board entities first
            selectedCell = null;
            document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
            el.classList.add('selected-template');
            selectedTemplate = el.dataset.type;
        }
        render();
    });
});

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);

    // Safety check: ensure localState exists
    if (!localState) return;

    const clickedEntity = localState.grid[y][x];

    // DESELECT: If clicking the currently selected cell, deselect it
    if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
        selectedCell = null;
        render();
        return;
    }

    // CASE 1: Spawn an entity
    if (selectedTemplate && !clickedEntity) {
        socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        deselectAll(); // Auto deselect after action
    }
    // CASE 2: Select an owned entity to move
    else if (clickedEntity && clickedEntity.owner === myId) {
        // Clear template selection if any
        if (selectedTemplate) {
            document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
            selectedTemplate = null;
        }
        selectedCell = { x, y };
    }
    // CASE 3: Move a previously selected entity
    else if (selectedCell && !clickedEntity) {
        socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
        selectedCell = null;
    }
    // CASE 4: Clicking opponent or empty space without valid action -> Deselect
    else {
        selectedCell = null;
    }

    render();
});

function updateLegend() {
    if (!localState || !localState.players) return;

    playerListElement.innerHTML = '';

    Object.keys(localState.players).forEach(id => {
        const p = localState.players[id];
        const isMe = id === myId;
        const isTurn = localState.turn === id;

        const li = document.createElement('li');
        li.className = 'player-item';
        // Highlight active player
        if (isTurn) {
            li.style.border = '2px solid #333';
            li.style.fontWeight = 'bold';
        }

        li.innerHTML = `
            <div class="player-color-box" style="background-color: ${p.color}"></div>
            <span>${isMe ? "You" : "Player"}</span>
            ${isTurn ? '<span class="current-turn-marker">TURN</span>' : ''}
        `;
        playerListElement.appendChild(li);
    });
}

function render() {
    if (!localState) return;

    // Update the status message
    if (localState.turn === myId) {
        status.innerText = "YOUR TURN";
        status.style.color = "#27ae60"; // Greenish
    } else {
        status.innerText = "Opponent's Turn...";
        status.style.color = "#c0392b"; // Reddish
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const entity = localState.grid[y][x];

            // 1. Draw Cell Background (Logic: Occupied cells get player color)
            if (entity) {
                const ownerData = localState.players[entity.owner];
                const color = ownerData ? ownerData.color : '#999';

                // Draw background with opacity
                ctx.globalAlpha = 0.3;
                ctx.fillStyle = color;
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 1.0;
            }

            // 2. Highlight selected cell (Yellow Border/Overlay)
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.fillStyle = "rgba(255, 215, 0, 0.4)"; // Gold highlight
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.strokeStyle = "gold";
                ctx.lineWidth = 3;
                ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                ctx.lineWidth = 1; // Reset
            }

            // 3. Highlight move hints
            if (selectedCell && isAdjacent(selectedCell, {x, y}) && !entity) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.2)"; // Green move hint
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
                // Optional: small dot in center
                ctx.beginPath();
                ctx.arc(x * CELL_SIZE + CELL_SIZE/2, y * CELL_SIZE + CELL_SIZE/2, 4, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(46, 204, 113, 0.6)";
                ctx.fill();
            }

            // 4. Draw Grid Lines
            ctx.strokeStyle = "#ddd";
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            // 5. Draw Entity Icon
            if (entity) {
                // Determine color for text/icon - black usually contrasts well with light backgrounds
                // For dark backgrounds, you might want white.
                ctx.fillStyle = "#000";

                // CENTER THE ICON
                ctx.font = "24px Arial"; // Slightly larger font
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                const icon = icons[entity.type] || '❓';

                // Calculate center of the cell
                const centerX = x * CELL_SIZE + (CELL_SIZE / 2);
                const centerY = y * CELL_SIZE + (CELL_SIZE / 2);

                ctx.fillText(icon, centerX, centerY);
            }
        }
    }
}

function isAdjacent(p1, p2) {
    const dx = Math.abs(p1.x - p2.x);
    const dy = Math.abs(p1.y - p2.y);
    return (dx + dy === 1);
}