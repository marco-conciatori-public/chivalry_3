// RENDERER: Handles all Canvas Drawing operations
const Renderer = {
    // Constants injected from Main
    GRID_SIZE: 10,
    CELL_SIZE: 0,
    ctx: null,
    minimapCtx: null,
    minimapCanvas: null,

    // Zoom & Pan State
    zoom: 1.0,
    panX: 0,
    panY: 0,

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
    assetPaths: {
        // Terrains
        'wall': '/images/wall.png',
        'forest': '/images/forest.png',
        'water': '/images/water.png',
        'street': '/images/street.png',
        'plains': '/images/plains.png',

        'light_infantry': '/images/light_infantry.png',
        'heavy_infantry': '/images/heavy_infantry.png',
        'archer': '/images/archer.png',
        'light_cavalry': '/images/light_cavalry.png',
        'heavy_cavalry': '/images/heavy_cavalry.png',
        'spearman': '/images/spearman.png',
        'catapult': '/images/catapult.png'
    },

    init(ctx, gridSize, canvasWidth, minimapCanvas) {
        this.ctx = ctx;
        this.GRID_SIZE = gridSize;
        this.CELL_SIZE = canvasWidth / gridSize;

        // Reset View
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;

        if (minimapCanvas) {
            this.minimapCanvas = minimapCanvas;
            this.minimapCtx = minimapCanvas.getContext('2d');
        }
    },

    setGridSize(size, canvasWidth) {
        this.GRID_SIZE = size;
        this.CELL_SIZE = canvasWidth / size;
    },

    // --- VIEWPORT MANIPULATION ---

    // Helper: Keeps the view within bounds so users don't lose the map
    clampPan() {
        const canvasW = this.ctx.canvas.width;
        const canvasH = this.ctx.canvas.height;

        // The constraints ensure we don't pan past the edges of the zoomed world
        // minPan is negative (shifting world left/up), maxPan is 0 (origin)
        const minPanX = canvasW * (1 - this.zoom);
        const maxPanX = 0;

        const minPanY = canvasH * (1 - this.zoom);
        const maxPanY = 0;

        this.panX = Math.min(Math.max(this.panX, minPanX), maxPanX);
        this.panY = Math.min(Math.max(this.panY, minPanY), maxPanY);
    },

    // Move the view by delta pixels (used for dragging)
    pan(dx, dy) {
        if (this.zoom <= 1.0) return; // Only allow panning if zoomed in
        this.panX += dx;
        this.panY += dy;
        this.clampPan();
    },

    // Jump view to center on a specific normalized position (0.0 - 1.0)
    centerOn(normalizedX, normalizedY) {
        const canvasW = this.ctx.canvas.width;
        const canvasH = this.ctx.canvas.height;

        // Calculate world coordinates relative to unzoomed size
        const worldX = normalizedX * canvasW;
        const worldY = normalizedY * canvasH;

        // Formula: screenCenter = worldCoord * zoom + pan
        // pan = screenCenter - worldCoord * zoom
        this.panX = (canvasW / 2) - (worldX * this.zoom);
        this.panY = (canvasH / 2) - (worldY * this.zoom);

        this.clampPan();
    },

    // Zoom towards a specific point (screenX, screenY)
    zoomAt(delta, screenX, screenY) {
        const oldZoom = this.zoom;
        const newZoom = Math.max(1.0, Math.min(oldZoom + delta, 3.0));

        if (newZoom === oldZoom) return;

        // Default to center if no mouse position provided
        if (screenX === undefined || screenX === null) {
            screenX = this.ctx.canvas.width / 2;
            screenY = this.ctx.canvas.height / 2;
        }

        const worldX = (screenX - this.panX) / oldZoom;
        const worldY = (screenY - this.panY) / oldZoom;

        this.zoom = newZoom;

        this.panX = screenX - (worldX * newZoom);
        this.panY = screenY - (worldY * newZoom);

        this.clampPan();
    },

    getZoom() {
        return this.zoom;
    },

    // --- ASSETS & HELPERS ---

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

    // --- MAIN DRAW ---

    draw(gameState, myId, selectedCell, interactionState, validMoves, validAttackTargets, cellsInAttackRange, gameConstants) {
        if (!gameState) return;

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

        // --- APPLY TRANSFORM (ZOOM & PAN) ---
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);
        this.ctx.scale(this.zoom, this.zoom);

        const fontSize = Math.floor(this.CELL_SIZE * 0.7);
        const maxElevation = gameConstants ? gameConstants.MAX_ELEVATION : 5;

        // --- LAYER 1: Background & Elevation ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (gameState.terrainMap) {
                    const terrain = gameState.terrainMap[y][x];

                    if (terrain.id === 'water') {
                        this.ctx.fillStyle = terrain.color;
                    } else if (terrain.id === 'street') {
                        const h = terrain.height;
                        const factor = Math.max(0, Math.min(1, h / maxElevation));
                        this.ctx.fillStyle = this.interpolateColor(VISUALS.STREET_LOW, VISUALS.STREET_HIGH, factor);
                    } else {
                        const h = terrain.height;
                        if (h >= maxElevation) {
                            this.ctx.fillStyle = VISUALS.HEIGHT_PEAK;
                        } else {
                            const range = Math.max(1, maxElevation - 1);
                            const factor = Math.max(0, Math.min(1, h / range));
                            this.ctx.fillStyle = this.interpolateColor(VISUALS.HEIGHT_LOW, VISUALS.HEIGHT_HIGH, factor);
                        }
                    }

                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

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

        // --- LAYER 1.5: Base Areas ---
        if (gameState.players) {
            Object.values(gameState.players).forEach(player => {
                if (player.baseArea) {
                    const bx = player.baseArea.x * this.CELL_SIZE;
                    const by = player.baseArea.y * this.CELL_SIZE;
                    const bw = player.baseArea.width * this.CELL_SIZE;
                    const bh = player.baseArea.height * this.CELL_SIZE;

                    this.ctx.fillStyle = player.color;
                    this.ctx.globalAlpha = 0.05;
                    this.ctx.fillRect(bx, by, bw, bh);
                    this.ctx.globalAlpha = 1.0;
                    this.ctx.strokeStyle = player.color;
                    this.ctx.lineWidth = 4;
                    this.ctx.strokeRect(bx, by, bw, bh);
                }
            });
            this.ctx.lineWidth = 1;
        }

        // --- LAYER 2: Terrain Features ---
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                if (!gameState.terrainMap) continue;
                const terrain = gameState.terrainMap[y][x];

                if (this.images[terrain.id]) {
                    this.ctx.drawImage(this.images[terrain.id], x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                } else if (terrain.symbol) {
                    this.drawTerrainSymbol(terrain.symbol, x, y, fontSize, 1, VISUALS);
                }
            }
        }

        // --- LAYER 3: Overlays ---
        if (selectedCell && gameState.grid && gameConstants) {
            const unit = gameState.grid[selectedCell.y][selectedCell.x];
            if (unit && unit.is_commander) {
                const range = gameConstants.COMMANDER_INFLUENCE_RANGE || 4;
                this.drawCommanderAura(selectedCell.x, selectedCell.y, range, VISUALS);
            }
        }

        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {

                // Selection
                if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
                    this.ctx.fillStyle = VISUALS.SELECTION_FILL;
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.strokeStyle = VISUALS.SELECTION_STROKE;
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                    this.ctx.lineWidth = 1;
                }

                // Interaction State
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

                    if (selectedCell && isReachable && !entityAtCell) {
                        this.ctx.fillStyle = VISUALS.MOVEMENT_FILL;
                        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                        this.ctx.beginPath();
                        this.ctx.arc(x * this.CELL_SIZE + this.CELL_SIZE/2, y * this.CELL_SIZE + this.CELL_SIZE/2, 4, 0, Math.PI * 2);
                        this.ctx.fillStyle = VISUALS.MOVEMENT_DOT;
                        this.ctx.fill();
                    } else if (showAttackRange) {
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

                    this.ctx.globalAlpha = 0.4;
                    this.ctx.fillStyle = color;
                    this.ctx.fillRect(x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                    this.ctx.globalAlpha = 1.0;

                    if (entity.remainingMovement <= 0 && entity.hasAttacked) {
                        this.ctx.globalAlpha = 0.5;
                    }

                    if (this.images[entity.type]) {
                        this.ctx.drawImage(this.images[entity.type], x * this.CELL_SIZE + 2, y * this.CELL_SIZE + 2, this.CELL_SIZE - 4, this.CELL_SIZE - 4);
                    } else {
                        this.ctx.fillStyle = VISUALS.TEXT_COLOR;
                        this.ctx.font = `${fontSize + 2}px Arial`;
                        this.ctx.textAlign = "center";
                        this.ctx.textBaseline = "middle";
                        const icon = this.icons[entity.type] || '❓';
                        this.ctx.fillText(icon, x * this.CELL_SIZE + (this.CELL_SIZE / 2), y * this.CELL_SIZE + (this.CELL_SIZE / 2));
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

        this.ctx.restore(); // Restore from Zoom/Pan

        this.drawMinimap(gameState, myId, VISUALS, maxElevation);
    },

    drawMinimap(gameState, myId, VISUALS, maxElevation) {
        if (!this.minimapCtx || !this.minimapCanvas) return;

        const ctx = this.minimapCtx;
        const width = this.minimapCanvas.width;
        const height = this.minimapCanvas.height;
        const miniCellSize = width / this.GRID_SIZE;

        ctx.clearRect(0, 0, width, height);

        // Draw Map
        for (let y = 0; y < this.GRID_SIZE; y++) {
            for (let x = 0; x < this.GRID_SIZE; x++) {
                const terrain = gameState.terrainMap[y][x];
                if (terrain.id === 'water') {
                    ctx.fillStyle = '#85c1e9';
                } else if (terrain.id === 'wall') {
                    ctx.fillStyle = '#7f8c8d';
                } else if (terrain.id === 'forest') {
                    ctx.fillStyle = '#27ae60';
                } else {
                    const factor = Math.max(0, Math.min(1, terrain.height / maxElevation));
                    ctx.fillStyle = this.interpolateColor('#66bb6a', '#ffffff', factor);
                }
                ctx.fillRect(x * miniCellSize, y * miniCellSize, miniCellSize, miniCellSize);

                const entity = gameState.grid[y][x];
                if (entity) {
                    const ownerData = gameState.players[entity.owner];
                    ctx.fillStyle = ownerData ? ownerData.color : '#999';
                    ctx.fillRect(x * miniCellSize + 1, y * miniCellSize + 1, miniCellSize - 2, miniCellSize - 2);
                }
            }
        }

        // Draw Viewport Rectangle
        // Calculate the visible area in game world coordinates
        // TopLeft World: (0 - panX) / zoom
        // BottomRight World: (canvasWidth - panX) / zoom
        const gameCanvasW = this.ctx.canvas.width;
        const gameCanvasH = this.ctx.canvas.height;

        const tlX = -this.panX / this.zoom;
        const tlY = -this.panY / this.zoom;
        const brX = (gameCanvasW - this.panX) / this.zoom;
        const brY = (gameCanvasH - this.panY) / this.zoom;

        // Convert World Coords (Pixels) to Minimap Coords
        // World Width = GRID_SIZE * CELL_SIZE
        const worldTotalW = this.GRID_SIZE * this.CELL_SIZE;
        const worldTotalH = this.GRID_SIZE * this.CELL_SIZE;

        // Normalized Viewport (0 to 1)
        const nX = tlX / worldTotalW;
        const nY = tlY / worldTotalH;
        const nW = (brX - tlX) / worldTotalW;
        const nH = (brY - tlY) / worldTotalH;

        // Draw Rect
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2;
        ctx.strokeRect(nX * width, nY * height, nW * width, nH * height);
    },

    drawTerrainSymbol(symbol, x, y, fontSize, size = 1, visuals) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.4;
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillStyle = visuals.TEXT_COLOR;
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
    },

    drawCommanderAura(cx, cy, range, visuals) {
        this.ctx.save();
        this.ctx.strokeStyle = visuals.COMMANDER_AURA_STROKE;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";

        const minX = Math.max(0, cx - range);
        const maxX = Math.min(this.GRID_SIZE - 1, cx + range);
        const minY = Math.max(0, cy - range);
        const maxY = Math.min(this.GRID_SIZE - 1, cy + range);

        this.ctx.fillStyle = visuals.COMMANDER_AURA_FILL;
        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                if (Math.abs(x - cx) + Math.abs(y - cy) <= range) {
                    this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);
                }
            }
        }

        this.ctx.restore();
    }
};