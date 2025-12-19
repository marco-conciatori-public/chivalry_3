const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');

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
    render();
});

socket.on('update', (state) => {
    localState = state;
    render();
});

// Select a template from the UI
document.querySelectorAll('.template').forEach(el => {
    el.addEventListener('click', () => {
        document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
        el.classList.add('selected-template');
        selectedTemplate = el.dataset.type;
    });
});

canvas.addEventListener('click', (e) => {
    console.log("Clicked coordinates:", x, y, "Selected Template:", selectedTemplate);
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((e.clientY - rect.top) / CELL_SIZE);

    // Safety check: ensure localState exists
    if (!localState) return;

    const clickedEntity = localState.grid[y][x];

    // CASE 1: Spawn an entity
    if (selectedTemplate && !clickedEntity) {
        socket.emit('spawnEntity', { x, y, type: selectedTemplate });
        selectedTemplate = null;
        document.querySelectorAll('.template').forEach(t => t.classList.remove('selected-template'));
    }
    // CASE 2: Select an owned entity to move
    else if (clickedEntity && clickedEntity.owner === myId) {
        selectedCell = { x, y };
    }
    // CASE 3: Move a previously selected entity
    else if (selectedCell && !clickedEntity) {
        socket.emit('moveEntity', { from: selectedCell, to: { x, y } });
        selectedCell = null;
    }
    else {
        selectedCell = null;
    }

    render();
});

function render() {
    if (!localState) return;
    // Update the status message
    if (localState.turn === myId) {
        status.innerText = "YOUR TURN";
        status.style.color = "green";
    } else {
        status.innerText = "Opponent's Turn...";
        status.style.color = "red";
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const entity = localState.grid[y][x];
            
            // Highlight selected cell
            if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                ctx.fillStyle = "rgba(255, 255, 0, 0.3)"; // Yellow highlight
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }

            // Highlight adjacent cells if an entity is selected
            if (selectedCell && isAdjacent(selectedCell, {x, y}) && !entity) {
                ctx.fillStyle = "rgba(0, 255, 0, 0.1)"; // Green highlight for moves
                ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            }

            ctx.strokeStyle = "#ccc";
            ctx.strokeRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);

            if (entity) {
                ctx.fillStyle = entity.owner === myId ? "blue" : "red";
                ctx.font = "20px Arial";
                const icon = icons[entity.type] || '❓';
                ctx.fillText(icon, x * CELL_SIZE + 10, y * CELL_SIZE + 30);
            }
        }
    }
}

// Re-use the isAdjacent function from the server logic here for the UI highlights
function isAdjacent(p1, p2) {
    const dx = Math.abs(p1.x - p2.x);
    const dy = Math.abs(p1.y - p2.y);
    return (dx + dy === 1); 
}