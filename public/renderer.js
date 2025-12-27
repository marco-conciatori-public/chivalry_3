// RENDERER: Handles all Canvas Drawing operations
const Renderer = {
    // Constants injected from Main
    GRID_SIZE: 10,
    CELL_SIZE: 0,
    ctx: null,

    // Fallback Icons
    icons: {
        light_infantry: '⚔️',
        heavy_infantry: '🛡️',
        archer: '🏹',
        light_cavalry: '🐎',
        heavy_cavalry: '🏇',
        spearman: '🔱',
    },

    // Image Management
    images: {},
    // Mapping of game keys to file paths.
    // Add files to the 'images' folder to enable them automatically.
    assetPaths: {
        // Terrains
        'wall': '/images/wall.png',
        'forest': '/images/forest.png',
        'mountain': '/images/mountain.png',
        'water': '/images/water.png',
        'street': '/images/street.png',
        'plains': '/images/plains.png',

        'light_infantry': '/images/light_infantry.png', // Placeholder
        'heavy_infantry': '/images/heavy_infantry.png', // Placeholder
        'archer': '/images/archer.png',
        'light_cavalry': '/images/light_cavalry.png',
        'heavy_cavalry': '/images/heavy_cavalry.png',   // Placeholder
        'spearman': '/images/spearman.png',         // Placeholder
    },

    init(ctx, gridSize, canvasWidth) {
        this.ctx = ctx;
        this.GRID_SIZE = gridSize;
        this.CELL_SIZE = canvasWidth / gridSize;
    },

    setGridSize(size, canvasWidth) {
        this.GRID_SIZE = size;
        this.CELL_SIZE = canvasWidth / size;
    },

    // Asynchronously load all images defined in assetPaths
    loadAssets() {
        return Promise.all(
            Object.entries(this.assetPaths).map(([key, src]) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.src = src;
                    img.onload = () => {
                        this.images[key] = img;
                        resolve();
                    };
                    img.onerror = () => {
                        resolve();
                    };
                });
            })
        );
    },

    draw(gameState, myId, selectedCell, interactionState, validMoves, validAttackTargets, cellsInAttackRange) {
        if (!gameState) return;

        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        // Dynamic Font
        const fontSize = Math.floor(this.CELL_SIZE * 0.7);

        // --- LAYER 1: Background Colors ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (gameState.terrainMap) {
                    const terrain = gameState.terrainMap[y][x];
                    this.ctx.fillStyle = terrain.color;
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            }
        }

        // --- LAYER 1.5: Base Areas (Highlights) ---
        if (gameState.players) {
            Object.values(gameState.players).forEach(player => {
                if (player.baseArea) {
                    const bx = player.baseArea.x * this.CELL_SIZE;
                    const by = player.baseArea.y * this.CELL_SIZE;
                    const bw = player.baseArea.width * this.CELL_SIZE;
                    const bh = player.baseArea.height * this.CELL_SIZE;

                    // Draw filled background for base (very subtle)
                    this.ctx.fillStyle = player.color;
                    this.ctx.globalAlpha = 0.05;
                    this.ctx.fillRect(bx, by, bw, bh);
                    this.ctx.globalAlpha = 1.0;

                    // Draw border
                    this.ctx.strokeStyle = player.color;
                    this.ctx.lineWidth = 4;
                    this.ctx.strokeRect(bx, by, bw, bh);
                }
            });
            this.ctx.lineWidth = 1; // Reset
        }

        // --- LAYER 2: Terrain Features (Images) ---
        // We use a set to keep track of mountain cells we've already drawn as part of a bigger block
        const coveredMountains = new Set();

        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (!gameState.terrainMap) continue;

                const terrain = gameState.terrainMap[y][x];

                // Special handling for Mountains to draw big images
                if (terrain.id === 'mountain') {
                    const key = `${x},${y}`;
                    if (coveredMountains.has(key)) continue;

                    let size = 1;

                    // Dynamically find maximum square size
                    // Keep increasing size as long as the square is valid (all mountains, not covered, in bounds)
                    while (this.checkSquare(gameState.terrainMap, x, y, size + 1, 'mountain', coveredMountains)) {
                        size++;
                    }

                    // Mark covered cells
                    for (let dy = 0; dy < size; dy++) {
                        for (let dx = 0; dx < size; dx++) {
                            coveredMountains.add(`${x + dx},${y + dy}`);
                        }
                    }

                    // Draw the mountain
                    if (this.images['mountain']) {
                        this.ctx.drawImage(this.images['mountain'], x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE * size, this.CELL_SIZE * size);
                    } else if (terrain.symbol) {
                        // Scale symbol if it's a block
                        this.drawTerrainSymbol(terrain.symbol, x, y, fontSize * size, size);
                    }

                } else {
                    // Standard Terrain Drawing
                    if (this.images[terrain.id]) {
                        this.ctx.drawImage(this.images[terrain.id], x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    } else if (terrain.symbol) {
                        this.drawTerrainSymbol(terrain.symbol, x, y, fontSize);
                    }
                }
            }
        }

        // --- LAYER 3: Overlays & Highlights ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {

                // 1. Selection Highlight
                if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                    this.ctx.fillStyle = "rgba(255, 215, 0, 0.4)";
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.strokeStyle = "gold";
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.lineWidth = 1;
                }

                // 2. Interaction Overlays
                if (interactionState === 'ROTATING' && selectedCell) {
                    const dx = x - selectedCell.x;
                    const dy = y - selectedCell.y;
                    if (Math.abs(dx) + Math.abs(dy) === 1) {
                        this.drawRotationArrow(x, y, dx, dy);
                    }
                }
                else if (interactionState === 'ATTACK_TARGETING') {
                    const isInRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                    if (isInRange) {
                        this.ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    }
                    const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
                    if (isTarget) {
                        this.ctx.strokeStyle = "red";
                        this.ctx.lineWidth = 3;
                        this.ctx.setLineDash([5, 5]);
                        this.ctx.strokeRect(x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                        this.ctx.setLineDash([]);
                        this.ctx.lineWidth = 1;
                    }
                }
                else if (interactionState === 'SELECTED' || interactionState === 'MENU') {
                    const isReachable = validMoves.some(m => m.x === x && m.y === y);
                    const entity = gameState.grid[y][x];
                    if (selectedCell && isReachable && !entity) {
                        this.ctx.fillStyle = "rgba(46, 204, 113, 0.4)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                        this.ctx.beginPath();
                        this.ctx.arc(x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2, 4, 0, Math.PI * 2);
                        this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                        this.ctx.fill();
                    }
                }

                // Grid Lines
                this.ctx.strokeStyle = "rgba(0,0,0,0.1)";
                this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
            }
        }

        // --- LAYER 4: Units ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                const entity = gameState.grid[y][x];

                if (entity) {
                    const ownerData = gameState.players[entity.owner];
                    const color = ownerData ? ownerData.color : '#999';

                    // Unit Background
                    this.ctx.globalAlpha = 0.4;
                    this.ctx.fillStyle = color;
                    this.ctx.fillRect(x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                    this.ctx.globalAlpha = 1.0;

                    if (entity.remainingMovement <= 0 && entity.hasAttacked) {
                        this.ctx.globalAlpha = 0.5;
                    }

                    // Try to draw Image
                    if (this.images[entity.type]) {
                        this.ctx.drawImage(this.images[entity.type], x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                    } else {
                        // Fallback to text icon
                        this.ctx.fillStyle = "#000";
                        this.ctx.font = `${fontSize + 2}px Arial`;
                        this.ctx.textAlign = "center";
                        this.ctx.textBaseline = "middle";
                        const icon = this.icons[entity.type] || '❓';
                        const centerX = x * this.CELL_SIZE + (this.CELL_SIZE / 2);
                        const centerY = y * this.CELL_SIZE + (this.CELL_SIZE / 2);
                        this.ctx.fillText(icon, centerX, centerY);
                    }

                    const centerX = x * this.CELL_SIZE + (this.CELL_SIZE / 2);
                    const centerY = y * this.CELL_SIZE + (this.CELL_SIZE / 2);

                    if (entity.is_commander) {
                        this.ctx.font = `${fontSize * 0.6}px Arial`;
                        this.ctx.fillText("👑", centerX, centerY - (fontSize * 0.6));
                    }

                    if (entity.is_fleeing) {
                        this.ctx.font = `${fontSize * 0.6}px Arial`;
                        this.ctx.fillText("🏳️", centerX + (fontSize * 0.5), centerY - (fontSize * 0.5));
                    }

                    this.drawFacingIndicator(x, y, entity.facing_direction, entity.remainingMovement > 0);
                    this.drawHealthBar(x, y, entity.current_health, entity.max_health);

                    this.ctx.globalAlpha = 1.0;
                }
            }
        }
    },

    // Helper to check if a square of 'type' exists at x,y with given size
    checkSquare(terrainMap, startX, startY, size, typeId, visitedSet) {
        if (startX + size > this.GRID_SIZE || startY + size > this.GRID_SIZE) return false;

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const tx = startX + x;
                const ty = startY + y;
                // Must be the correct type AND not already covered by another block
                if (terrainMap[ty][tx].id !== typeId || visitedSet.has(`${tx},${ty}`)) {
                    return false;
                }
            }
        }
        return true;
    },

    drawTerrainSymbol(symbol, x, y, fontSize, size = 1) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.3;
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = "#000";
        // Calculate center based on size (1 cell or multiple cells)
        const centerX = x * this.CELL_SIZE + (this.CELL_SIZE * size) / 2;
        const centerY = y * this.CELL_SIZE + (this.CELL_SIZE * size) / 2;
        this.ctx.fillText(symbol, centerX, centerY);
        this.ctx.restore();
    },

    drawFacingIndicator(gridX, gridY, direction, isActive) {
        const cx = gridX * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const cy = gridY * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const radius = this.CELL_SIZE / 2.2;

        this.ctx.save();
        this.ctx.translate(cx, cy);

        let rotation = 0;
        if (direction === 0) rotation = -Math.PI / 2;
        if (direction === 2) rotation = 0;
        if (direction === 4) rotation = Math.PI / 2;
        if (direction === 6) rotation = Math.PI;

        this.ctx.rotate(rotation);
        this.ctx.beginPath();
        this.ctx.moveTo(radius, 0);
        this.ctx.lineTo(radius - 8, -6);
        this.ctx.lineTo(radius - 8, 6);
        this.ctx.closePath();
        this.ctx.fillStyle = isActive ? "#FFD700" : "#555";
        this.ctx.fill();
        this.ctx.strokeStyle = "#000";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.restore();
    },

    drawRotationArrow(gridX, gridY, dx, dy) {
        const cx = gridX * this.CELL_SIZE + (this.CELL_SIZE / 2);
        const cy = gridY * this.CELL_SIZE + (this.CELL_SIZE / 2);

        this.ctx.save();
        this.ctx.translate(cx, cy);

        let rotation = 0;
        if (dx === 1) rotation = 0;
        if (dx === -1) rotation = Math.PI;
        if (dy === 1) rotation = Math.PI/2;
        if (dy === -1) rotation = -Math.PI/2;

        this.ctx.rotate(rotation);
        this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        this.ctx.beginPath();
        this.ctx.moveTo(10, 0);
        this.ctx.lineTo(-5, 7);
        this.ctx.lineTo(-5, -7);
        this.ctx.fill();
        this.ctx.restore();
    },

    drawHealthBar(gridX, gridY, current, max) {
        const barWidth = this.CELL_SIZE - 4;
        const barHeight = 2;
        const x = gridX * this.CELL_SIZE + 2;
        const y = gridY * this.CELL_SIZE + this.CELL_SIZE - 4;
        const pct = Math.max(0, current / max);
        this.ctx.fillStyle = "red";
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.fillStyle = "#2ecc71";
        this.ctx.fillRect(x, y, barWidth * pct, barHeight);
    }
};