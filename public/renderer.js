// RENDERER: Handles all Canvas Drawing operations
const Renderer = {
    // Constants injected from Main
    GRID_SIZE: 10,
    CELL_SIZE: 0,
    ctx: null,
    minimapCtx: null,
    minimapCanvas: null,
    zoom: 1.0,

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

    init(ctx, gridSize, canvasWidth, minimapCanvas) {
        this.ctx = ctx;
        this.GRID_SIZE = gridSize;
        this.CELL_SIZE = canvasWidth / gridSize;

        if (minimapCanvas) {
            this.minimapCanvas = minimapCanvas;
            this.minimapCtx = minimapCanvas.getContext('2d');
        }
    },

    setGridSize(size, canvasWidth) {
        this.GRID_SIZE = size;
        this.CELL_SIZE = canvasWidth / size;
    },

    setZoom(newZoom) {
        // Clamp zoom between 0.5 (zoomed out) and 3.0 (zoomed in)
        this.zoom = Math.max(0.5, Math.min(newZoom, 3.0));
    },

    getZoom() {
        return this.zoom;
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

        // Visual Configuration from Constants
        const VISUALS = gameConstants.VISUALS || {
            HEIGHT_LOW: '#66bb6a', HEIGHT_HIGH: '#8d6e63', HEIGHT_PEAK: '#ffffff',
            STREET_LOW: '#e0e0e0', STREET_HIGH: '#424242',
            SELECTION_FILL: "rgba(255, 215, 0, 0.4)", SELECTION_STROKE: "gold",
            ATTACK_RANGE_FILL: "rgba(255, 0, 0, 0.2)", ATTACK_TARGET_STROKE: "red",
            MOVEMENT_FILL: "rgba(46, 204, 113, 0.4)", MOVEMENT_DOT: "rgba(255, 255, 255, 0.8)",
            GRID_LINES: "rgba(0,0,0,0.1)", COMMANDER_AURA_FILL: "rgba(241, 196, 15, 0.1)",
            COMMANDER_AURA_STROKE: "#f1c40f", FACING_ACTIVE: "#FFD700", FACING_INACTIVE: "#555",
            FACING_STROKE: "#000", ROTATION_ARROW: "rgba(0, 0, 0, 0.5)", HEALTH_BAR_BG: "red",
            HEALTH_BAR_FG: "#2ecc71", TEXT_COLOR: "#000", TEXT_HEIGHT_COLOR: "rgba(0,0,0,0.2)",
            DEFAULT_OWNER: "#999"
        };

        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

        // --- APPLY ZOOM ---
        this.ctx.save();
        this.ctx.scale(this.zoom, this.zoom);

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
                    } else if (terrain.id === 'street') {
                        // Street Logic: Gray scale based on height
                        const h = terrain.height;
                        const maxH = maxElevation;

                        // Calculate factor based on height relative to max elevation
                        const factor = Math.max(0, Math.min(1, h / maxH));
                        this.ctx.fillStyle = this.interpolateColor(VISUALS.STREET_LOW, VISUALS.STREET_HIGH, factor);

                    } else {
                        // Gradient Logic: Green -> Brown -> White
                        const h = terrain.height;
                        const maxH = maxElevation;

                        // If height >= maxElevation (including walls at 6, 7 etc), use Peak White
                        if (h >= maxH) {
                            this.ctx.fillStyle = VISUALS.HEIGHT_PEAK;
                        } else {
                            // Interpolate between Low and High
                            const range = Math.max(1, maxH - 1);
                            const factor = Math.max(0, Math.min(1, h / range));
                            this.ctx.fillStyle = this.interpolateColor(VISUALS.HEIGHT_LOW, VISUALS.HEIGHT_HIGH, factor);
                        }
                    }

                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

                    // Draw Height Number (Subtle) for clarity
                    if (terrain.id !== 'water' && this.CELL_SIZE > 20) {
                        this.ctx.fillStyle = VISUALS.TEXT_HEIGHT_COLOR;
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
                    this.drawTerrainSymbol(terrain.symbol, x, y, fontSize, 1, VISUALS);
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
                this.drawCommanderAura(selectedCell.x, selectedCell.y, range, VISUALS);
            }
        }

        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {

                // 1. Selection Highlight
                if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                    this.ctx.fillStyle = VISUALS.SELECTION_FILL;
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.strokeStyle = VISUALS.SELECTION_STROKE;
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.lineWidth = 1;
                }

                // 2. Interaction Overlays
                if (interactionState === 'ROTATING' && selectedCell) {
                    const dx = x - selectedCell.x;
                    const dy = y - selectedCell.y;
                    if (Math.abs(dx) + Math.abs(dy) === 1) {
                        this.drawRotationArrow(x, y, dx, dy, VISUALS);
                    }
                }
                else if (interactionState === 'ATTACK_TARGETING') {
                    const isInRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                    if (isInRange) {
                        this.ctx.fillStyle = VISUALS.ATTACK_RANGE_FILL;
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    }
                    const isTarget = validAttackTargets.some(t => t.x === x && t.y === y);
                    if (isTarget) {
                        this.ctx.strokeStyle = VISUALS.ATTACK_TARGET_STROKE;
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

                    let showAttackRange = false;
                    if (selectedCell) {
                        const selectedUnit = gameState.grid[selectedCell.y][selectedCell.x];
                        if (selectedUnit && selectedUnit.is_ranged) {
                            showAttackRange = cellsInAttackRange.some(c => c.x === x && c.y === y);
                        }
                    }

                    // Priority: Movement > Attack Range
                    if (selectedCell && isReachable && !entityAtCell) {
                        this.ctx.fillStyle = VISUALS.MOVEMENT_FILL;
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                        this.ctx.beginPath();
                        this.ctx.arc(x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2, 4, 0, Math.PI * 2);
                        this.ctx.fillStyle = VISUALS.MOVEMENT_DOT;
                        this.ctx.fill();
                    } else if (showAttackRange) {
                        // Draw Attack Range
                        this.ctx.fillStyle = VISUALS.ATTACK_RANGE_FILL;
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    }
                }

                // Grid Lines
                this.ctx.strokeStyle = VISUALS.GRID_LINES;
                this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
            }
        }

        // --- LAYER 4: Units ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                const entity = gameState.grid[y][x];

                if (entity) {
                    const ownerData = gameState.players[entity.owner];
                    const color = ownerData ? ownerData.color : VISUALS.DEFAULT_OWNER;

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
                        this.ctx.fillStyle = VISUALS.TEXT_COLOR;
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

                    this.drawFacingIndicator(x, y, entity.facing_direction, entity.remainingMovement > 0, VISUALS);
                    this.drawHealthBar(x, y, entity.current_health, entity.max_health, VISUALS);

                    this.ctx.globalAlpha = 1.0;
                }
            }
        }

        this.ctx.restore();

        // After main draw, update Minimap
        this.drawMinimap(gameState, myId, VISUALS, maxElevation);
    },

    drawMinimap(gameState, myId, VISUALS, maxElevation) {
        if (!this.minimapCtx || !this.minimapCanvas) return;

        const ctx = this.minimapCtx;
        const width = this.minimapCanvas.width;
        const height = this.minimapCanvas.height;
        const miniCellSize = width / this.GRID_SIZE;

        ctx.clearRect(0, 0, width, height);

        // Draw Terrain (Simplified)
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                const terrain = gameState.terrainMap[y][x];

                // Simplified Elevation Color
                if (terrain.id === 'water') {
                    ctx.fillStyle = '#85c1e9'; // Water Blue
                } else if (terrain.id === 'wall') {
                    ctx.fillStyle = '#7f8c8d'; // Wall Gray
                } else if (terrain.id === 'forest') {
                    ctx.fillStyle = '#27ae60'; // Forest Green
                } else {
                    // Ground Height scaling
                    const factor = Math.max(0, Math.min(1, terrain.height / maxElevation));
                    // Interpolate simplified colors for speed/clarity
                    ctx.fillStyle = this.interpolateColor('#66bb6a', '#ffffff', factor);
                }
                ctx.fillRect(x * miniCellSize, y * miniCellSize, miniCellSize, miniCellSize);

                // Draw Units as Dots
                const entity = gameState.grid[y][x];
                if (entity) {
                    const ownerData = gameState.players[entity.owner];
                    ctx.fillStyle = ownerData ? ownerData.color : '#999';
                    // Draw a slightly smaller rect/dot
                    ctx.fillRect(x * miniCellSize + 1, y * miniCellSize + 1, miniCellSize - 2, miniCellSize - 2);
                }
            }
        }

        // Draw Viewport Rect (The area currently visible)
        // With zoom, we assume panning is not yet implemented (centered zoom),
        // OR if simple scaling, the viewport is always "all", but scaled.
        // If "Zoomable Grid" means scaling the canvas, the viewport doesn't change relative to the grid content, just size.
        // However, standard minimaps often show a camera rect.
        // For now, since panning isn't fully implemented in logic, just the drawing.
    },

    // Draws the yellow perimeter around a commander's influence range
    drawCommanderAura(cx, cy, range, visuals) {
        this.ctx.save();
        this.ctx.strokeStyle = visuals.COMMANDER_AURA_STROKE;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";

        const minX = Math.max(0, cx - range);
        const maxX = Math.min(this.GRID_SIZE - 1, cx + range);
        const minY = Math.max(0, cy - range);
        const maxY = Math.min(this.GRID_SIZE - 1, cy + range);

        // First pass: Draw faint fill
        this.ctx.fillStyle = visuals.COMMANDER_AURA_FILL;
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

    drawTerrainSymbol(symbol, x, y, fontSize, size = 1, visuals) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.4;
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = visuals.TEXT_COLOR;
        // Calculate center based on size (1 cell or multiple cells)
        const centerX = x * this.CELL_SIZE + (this.CELL_SIZE * size) / 2;
        const centerY = y * this.CELL_SIZE + (this.CELL_SIZE * size) / 2;
        this.ctx.fillText(symbol, centerX, centerY);
        this.ctx.restore();
    },

    drawFacingIndicator(gridX, gridY, direction, isActive, visuals) {
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
        this.ctx.fillStyle = isActive ? visuals.FACING_ACTIVE : visuals.FACING_INACTIVE;
        this.ctx.fill();
        this.ctx.strokeStyle = visuals.FACING_STROKE;
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.ctx.restore();
    },

    drawRotationArrow(gridX, gridY, dx, dy, visuals) {
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
        this.ctx.fillStyle = visuals.ROTATION_ARROW;
        this.ctx.beginPath();
        this.ctx.moveTo(10, 0);
        this.ctx.lineTo(-5, 7);
        this.ctx.lineTo(-5, -7);
        this.ctx.fill();
        this.ctx.restore();
    },

    drawHealthBar(gridX, gridY, current, max, visuals) {
        const barWidth = this.CELL_SIZE - 4;
        const barHeight = 2;
        const x = gridX * this.CELL_SIZE + 2;
        const y = gridY * this.CELL_SIZE + this.CELL_SIZE - 4;
        const pct = Math.max(0, current / max);
        this.ctx.fillStyle = visuals.HEALTH_BAR_BG;
        this.ctx.fillRect(x, y, barWidth, barHeight);
        this.ctx.fillStyle = visuals.HEALTH_BAR_FG;
        this.ctx.fillRect(x, y, barWidth * pct, barHeight);
    }
};