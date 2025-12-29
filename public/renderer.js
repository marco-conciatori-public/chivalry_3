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
        catapult: '☄️'
    },

    // Image Management
    images: {},
    // Mapping of game keys to file paths.
    // Add files to the 'images' folder to enable them automatically.
    assetPaths: {
        // Terrains
        'wall': '/images/wall.png',
        'forest': '/images/forest.png',
        'water': '/images/water.png',
        'street': '/images/street.png',
        'plains': '/images/plains.png',

        'light_infantry': '/images/light_infantry.png', // Placeholder
        'heavy_infantry': '/images/heavy_infantry.png', // Placeholder
        'archer': '/images/archer.png',
        'light_cavalry': '/images/light_cavalry.png',
        'heavy_cavalry': '/images/heavy_cavalry.png',   // Placeholder
        'spearman': '/images/spearman.png',         // Placeholder
        'catapult': '/images/catapult.png'
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

    // Helper to interpolate between two hex colors
    interpolateColor(color1, color2, factor) {
        if (factor > 1) factor = 1;
        if (factor < 0) factor = 0;

        const r1 = parseInt(color1.substring(1, 3), 16);
        const g1 = parseInt(color1.substring(3, 5), 16);
        const b1 = parseInt(color1.substring(5, 7), 16);

        const r2 = parseInt(color2.substring(1, 3), 16);
        const g2 = parseInt(color2.substring(3, 5), 16);
        const b2 = parseInt(color2.substring(5, 7), 16);

        const r = Math.round(r1 + factor * (r2 - r1));
        const g = Math.round(g1 + factor * (g2 - g1));
        const b = Math.round(b1 + factor * (b2 - b1));

        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    // Helper to adjust brightness of a hex color
    adjustColorBrightness(hex, percent) {
        // Strip the #
        hex = hex.replace(/^\s*#|\s*$/g, '');
        // Convert to RGB
        var r = parseInt(hex.substr(0, 2), 16);
        var g = parseInt(hex.substr(2, 2), 16);
        var b = parseInt(hex.substr(4, 2), 16);

        // Calculate adjustment
        var amt = Math.floor(2.55 * percent);

        r += amt;
        g += amt;
        b += amt;

        // Clamp
        if (r > 255) r = 255; else if (r < 0) r = 0;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        if (b > 255) b = 255; else if (b < 0) b = 0;

        // Return new hex
        return '#' + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
    },

    draw(gameState, myId, selectedCell, interactionState, validMoves, validAttackTargets, cellsInAttackRange, gameConstants) {
        if (!gameState) return;

        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        // Dynamic Font
        const fontSize = Math.floor(this.CELL_SIZE * 0.7);
        const maxElevation = gameConstants ? gameConstants.MAX_ELEVATION : 5;

        // --- LAYER 1: Background & Elevation ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (gameState.terrainMap) {
                    const terrain = gameState.terrainMap[y][x];
                    let baseColor = terrain.color;

                    // Elevation Coloring Logic
                    if (terrain.id === 'water') {
                        // Keep base water color
                        this.ctx.fillStyle = baseColor;
                    } else {
                        // Gradient Logic: Green -> Brown -> White
                        const h = terrain.height;
                        const maxH = maxElevation; // Should be 5

                        // Colors
                        const C_LOW = '#66bb6a';   // Green (Height 0) - Nice Grass Green
                        const C_HIGH = '#8d6e63';  // Brown (Height Max-1) - Earthy Brown
                        const C_PEAK = '#ffffff';  // White (Height Max)

                        // If height >= maxElevation (including walls at 6, 7 etc), use Peak White
                        if (h >= maxH) {
                            this.ctx.fillStyle = C_PEAK;
                        } else {
                            // Interpolate between Low and High (0 to 4)
                            // h goes from 0 to maxH - 1
                            const range = Math.max(1, maxH - 1);
                            const factor = Math.max(0, Math.min(1, h / range));
                            this.ctx.fillStyle = this.interpolateColor(C_LOW, C_HIGH, factor);
                        }
                    }

                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

                    // Draw Height Number (Subtle) for clarity
                    if (terrain.id !== 'water' && this.CELL_SIZE > 20) {
                        this.ctx.fillStyle = "rgba(0,0,0,0.2)";
                        this.ctx.font = `${Math.floor(this.CELL_SIZE * 0.25)}px Arial`;
                        this.ctx.textAlign = "right";
                        this.ctx.textBaseline = "bottom";
                        this.ctx.fillText(terrain.height, (x+1) * this.CELL_SIZE - 2, (y+1) * this.CELL_SIZE - 2);
                    }
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
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (!gameState.terrainMap) continue;

                const terrain = gameState.terrainMap[y][x];

                // Draw Images for specific types (Forest, Wall, Water if textured)
                if (this.images[terrain.id]) {
                    this.ctx.drawImage(this.images[terrain.id], x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                } else if (terrain.symbol) {
                    this.drawTerrainSymbol(terrain.symbol, x, y, fontSize);
                }
            }
        }

        // --- LAYER 3: Overlays & Highlights ---

        // Draw Commander Aura (Underlay for visibility)
        if (selectedCell && gameState.grid && gameConstants) {
            const unit = gameState.grid[selectedCell.y][selectedCell.x];
            // Check if unit exists and is a commander (friendly or enemy)
            if (unit && unit.is_commander) {
                const range = gameConstants.COMMANDER_INFLUENCE_RANGE || 4;
                this.drawCommanderAura(selectedCell.x, selectedCell.y, range);
            }
        }

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
                    const entityAtCell = gameState.grid[y][x];

                    // Check for Ranged Unit Attack Range Display
                    let showAttackRange = false;
                    if (selectedCell) {
                        const selectedUnit = gameState.grid[selectedCell.y][selectedCell.x];
                        // If it's a ranged unit, check the range
                        // Note: We rely on cellsInAttackRange being populated correctly in game.js
                        // based on whether we are commanding or inspecting the unit.
                        if (selectedUnit && selectedUnit.is_ranged) {
                            showAttackRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                        }
                    }

                    // Priority: Movement (Green) > Attack Range (Red)
                    if (selectedCell && isReachable && !entityAtCell) {
                        this.ctx.fillStyle = "rgba(46, 204, 113, 0.4)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                        this.ctx.beginPath();
                        this.ctx.arc(x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2, 4, 0, Math.PI * 2);
                        this.ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
                        this.ctx.fill();
                    } else if (showAttackRange) {
                        // Draw Attack Range
                        this.ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
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

    // Draws the yellow perimeter around a commander's influence range
    drawCommanderAura(cx, cy, range) {
        this.ctx.save();
        this.ctx.strokeStyle = "#f1c40f"; // Yellow
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";

        const minX = Math.max(0, cx - range);
        const maxX = Math.min(this.GRID_SIZE - 1, cx + range);
        const minY = Math.max(0, cy - range);
        const maxY = Math.min(this.GRID_SIZE - 1, cy + range);

        // First pass: Draw faint fill
        this.ctx.fillStyle = "rgba(241, 196, 15, 0.1)";
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (Math.abs(x - cx) + Math.abs(y - cy) <= range) {
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            }
        }

        // Second pass: Draw border lines on edges
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                const dist = Math.abs(x - cx) + Math.abs(y - cy);
                if (dist > range) continue;

                const screenX = x * this.CELL_SIZE;
                const screenY = y * this.CELL_SIZE;

                // Check neighbors. If neighbor is out of range or out of bounds, draw edge.

                // Top Edge
                if ((y - 1 < 0) || (Math.abs(x - cx) + Math.abs((y - 1) - cy) > range)) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX, screenY);
                    this.ctx.lineTo(screenX + this.CELL_SIZE, screenY);
                    this.ctx.stroke();
                }
                // Bottom Edge
                if ((y + 1 >= this.GRID_SIZE) || (Math.abs(x - cx) + Math.abs((y + 1) - cy) > range)) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX, screenY + this.CELL_SIZE);
                    this.ctx.lineTo(screenX + this.CELL_SIZE, screenY + this.CELL_SIZE);
                    this.ctx.stroke();
                }
                // Left Edge
                if ((x - 1 < 0) || (Math.abs((x - 1) - cx) + Math.abs(y - cy) > range)) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX, screenY);
                    this.ctx.lineTo(screenX, screenY + this.CELL_SIZE);
                    this.ctx.stroke();
                }
                // Right Edge
                if ((x + 1 >= this.GRID_SIZE) || (Math.abs((x + 1) - cx) + Math.abs(y - cy) > range)) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(screenX + this.CELL_SIZE, screenY);
                    this.ctx.lineTo(screenX + this.CELL_SIZE, screenY + this.CELL_SIZE);
                    this.ctx.stroke();
                }
            }
        }

        this.ctx.restore();
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
        this.ctx.globalAlpha = 0.4;
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