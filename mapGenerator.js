const constants = require('./constants');

function generateMap(gameState) {
    // Read constants inside function to ensure dynamic updates from Server are caught
    const GRID_SIZE = constants.GRID_SIZE;
    const CFG = constants.MAP_GEN;
    const TARGET_MAX_HEIGHT = constants.MAX_ELEVATION; // Should be 5

    // 1. Reset to Plains (Use UNIQUE objects for each cell to allow independent height)
    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            gameState.terrainMap[y][x] = { ...constants.TERRAIN.PLAINS };
        }
    }

    // --- NEW VALID ZONE LOGIC FOR 4 PLAYERS ---
    const G = GRID_SIZE;
    const dimLong = Math.floor(G / 2);
    const dimShort = Math.max(Math.floor(G / 20), 2);
    const centerOffset = Math.floor((G - dimLong) / 2);

    // Define the 4 forbidden base rectangles
    const bases = [
        { x: centerOffset, y: 0, w: dimLong, h: dimShort },           // P1 (Top)
        { x: centerOffset, y: G - dimShort, w: dimLong, h: dimShort }, // P2 (Bottom)
        { x: 0, y: centerOffset, w: dimShort, h: dimLong },           // P3 (Left)
        { x: G - dimShort, y: centerOffset, w: dimShort, h: dimLong }  // P4 (Right)
    ];

    const isValidZone = (x, y) => {
        // Check map bounds
        if (x < 0 || x >= G || y < 0 || y >= G) return false;

        // Check against any base area
        for (let b of bases) {
            if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
                return false;
            }
        }
        return true;
    };

    const areaScale = (GRID_SIZE * GRID_SIZE) / CFG.BASE_AREA;

    // --- GENERATE ELEVATION MAP ---
    // Algorithm: Initialize random heights, then smooth repeatedly.
    // This creates natural slopes where adjacent cells have small differences.
    let heightMap = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));

    // Seed
    for(let y=0; y<GRID_SIZE; y++) {
        for(let x=0; x<GRID_SIZE; x++) {
            heightMap[y][x] = Math.random() * (TARGET_MAX_HEIGHT + 1);
        }
    }

    // Smooth (Average with neighbors)
    const iterations = 4;
    for(let i=0; i<iterations; i++) {
        let newMap = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));
        for(let y=0; y<GRID_SIZE; y++) {
            for(let x=0; x<GRID_SIZE; x++) {
                let sum = heightMap[y][x];
                let count = 1;

                // Check neighbors
                const dirs = [[0,1],[0,-1],[1,0],[-1,0]];
                for(let d of dirs) {
                    const ny = y + d[1];
                    const nx = x + d[0];
                    if(nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
                        sum += heightMap[ny][nx];
                        count++;
                    }
                }

                newMap[y][x] = sum / count;
            }
        }
        heightMap = newMap;
    }

    // --- NORMALIZE ELEVATION ---
    // This ensures we always have heights ranging exactly from 0 to TARGET_MAX_HEIGHT (5)
    // Smoothing tends to pull values towards the middle, eliminating 0s and 5s. This fixes that.
    let minH = Infinity;
    let maxH = -Infinity;

    for(let y=0; y<GRID_SIZE; y++) {
        for(let x=0; x<GRID_SIZE; x++) {
            if (heightMap[y][x] < minH) minH = heightMap[y][x];
            if (heightMap[y][x] > maxH) maxH = heightMap[y][x];
        }
    }

    // Prevent division by zero if map is flat
    if (maxH === minH) {
        maxH = minH + 1;
    }

    // Apply Elevation to Grid (Rounding to integers)
    for(let y=0; y<GRID_SIZE; y++) {
        for(let x=0; x<GRID_SIZE; x++) {
            // Normalize current value to 0..1 range
            const normalized = (heightMap[y][x] - minH) / (maxH - minH);

            // Tweak: Bias towards lower heights. Power > 1 pushes values down.
            // 2.5 creates a stronger curve favoring lower ground (mostly plains).
            const biased = Math.pow(normalized, 2.5);

            // Scale to target range (0..5)
            const scaled = biased * TARGET_MAX_HEIGHT;

            const finalH = Math.round(scaled);
            gameState.terrainMap[y][x].height = finalH;
        }
    }

    // --- WALLS ---
    // Walls now sit ON TOP of the terrain height
    const baseWalls = Math.floor(Math.random() * CFG.WALLS.BASE_VAR) + CFG.WALLS.BASE_MIN;
    const numWalls = Math.floor(baseWalls * areaScale * CFG.WALLS.DENSITY);

    for (let i = 0; i < numWalls; i++) {
        let startX = Math.floor(Math.random() * GRID_SIZE);
        let startY = Math.floor(Math.random() * GRID_SIZE);
        let isVertical = Math.random() < 0.5;
        let length = Math.floor(Math.random() * CFG.WALLS.LENGTH_VAR) + CFG.WALLS.LENGTH_MIN;

        for (let l = 0; l < length; l++) {
            let wx = isVertical ? startX : startX + l;
            let wy = isVertical ? startY + l : startY;

            if (isValidZone(wx, wy) && (gameState.terrainMap[wy][wx].id === 'plains')) {
                const currentHeight = gameState.terrainMap[wy][wx].height;
                // Wall is a new object inheriting from WALL constant
                // With max elevation 5, walls can reach 7.
                gameState.terrainMap[wy][wx] = {
                    ...constants.TERRAIN.WALL,
                    height: currentHeight + 2 // Wall adds height
                };
            }
        }
    }

    // --- FORESTS ---
    // Forests sit ON TOP of terrain (inherit ground height)
    const baseForests = Math.floor(Math.random() * CFG.FORESTS.BASE_VAR) + CFG.FORESTS.BASE_MIN;
    const numForests = Math.floor(baseForests * areaScale * CFG.FORESTS.DENSITY);

    for (let i = 0; i < numForests; i++) {
        let cx = Math.floor(Math.random() * GRID_SIZE);
        let cy = Math.floor(Math.random() * GRID_SIZE);

        if (isValidZone(cx, cy)) {
            const blobSize = Math.floor(Math.random() * CFG.FORESTS.BLOB_SIZE_VAR) + CFG.FORESTS.BLOB_SIZE_MIN;
            let openSet = [{x: cx, y: cy}];
            let placedCount = 0;

            while(placedCount < blobSize && openSet.length > 0) {
                let idx = Math.floor(Math.random() * openSet.length);
                let current = openSet.splice(idx, 1)[0];

                if (isValidZone(current.x, current.y)) {
                    if (gameState.terrainMap[current.y][current.x].id === 'plains') {
                        const currentHeight = gameState.terrainMap[current.y][current.x].height;

                        // Check against MAX_FOREST_HEIGHT (Default to full height if constant missing)
                        const heightLimit = CFG.FORESTS.MAX_HEIGHT !== undefined ? CFG.FORESTS.MAX_HEIGHT : TARGET_MAX_HEIGHT;

                        if (currentHeight <= heightLimit) {
                            gameState.terrainMap[current.y][current.x] = {
                                ...constants.TERRAIN.FOREST,
                                height: currentHeight
                            };
                            placedCount++;
                            [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}].forEach(({dx, dy}) => {
                                openSet.push({x: current.x + dx, y: current.y + dy});
                            });
                        }
                    }
                }
            }
        }
    }

    // --- RIVERS ---
    // Rivers override height to -2
    // Reduced density by multiplier 0.6
    const numRivers = Math.max(1, Math.floor(areaScale * CFG.RIVERS.DENSITY * 0.6));
    for(let r=0; r<numRivers; r++) {
        let rx = Math.floor(Math.random() * GRID_SIZE);
        let ry = Math.floor(Math.random() * GRID_SIZE);
        let riverLength = Math.floor(GRID_SIZE * CFG.RIVERS.LENGTH_FACTOR);

        for(let i=0; i<riverLength; i++) {
            if (isValidZone(rx, ry)) {
                // Only replace if it's not a wall (optional choice, keeps walls intact)
                if (gameState.terrainMap[ry][rx].id !== 'wall') {
                    gameState.terrainMap[ry][rx] = { ...constants.TERRAIN.WATER };
                }
            }
            let move = Math.random();
            if (move < 0.5) rx += (Math.random() < 0.5 ? 1 : -1);
            else ry += (Math.random() < 0.5 ? 1 : -1);
        }
    }

    // --- STREETS ---
    // Streets sit on ground height
    const isStreet = (gx, gy) => {
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return false;
        return gameState.terrainMap[gy][gx].id === 'street';
    };

    const causesBlob = (tx, ty) => {
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty-1) && isStreet(tx, ty-1)) return true;
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty-1) && isStreet(tx, ty-1)) return true;
        if (isStreet(tx-1, ty) && isStreet(tx-1, ty+1) && isStreet(tx, ty+1)) return true;
        if (isStreet(tx+1, ty) && isStreet(tx+1, ty+1) && isStreet(tx, ty+1)) return true;
        return false;
    };

    const numStreets = Math.floor(Math.random() * CFG.STREETS.BASE_VAR) + CFG.STREETS.BASE_MIN;
    const totalStreets = Math.floor(numStreets * Math.sqrt(areaScale) * 0.6);

    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

    for(let i=0; i<totalStreets; i++) {
        let x, y;
        let attempts = 0;
        let foundStart = false;
        while(attempts < 50 && !foundStart) {
            x = Math.floor(Math.random() * GRID_SIZE);
            y = Math.floor(Math.random() * GRID_SIZE);
            if (isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains') {
                foundStart = true;
            }
            attempts++;
        }
        if (!foundStart) continue;

        let length = Math.floor(GRID_SIZE * CFG.STREETS.LENGTH_FACTOR);
        let currentDir = dirs[Math.floor(Math.random() * dirs.length)];

        for(let j=0; j<length; j++) {
            if(isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains' && !causesBlob(x, y)) {
                const currentHeight = gameState.terrainMap[y][x].height;
                gameState.terrainMap[y][x] = {
                    ...constants.TERRAIN.STREET,
                    height: currentHeight
                };
            }
            let nextX = x + currentDir[0];
            let nextY = y + currentDir[1];
            let isBlocked = true;
            if (isValidZone(nextX, nextY)) {
                const target = gameState.terrainMap[nextY][nextX];
                if (target.id === 'plains' || target.id === 'street') isBlocked = false;
            }
            if (isBlocked || Math.random() < CFG.STREETS.TURN_BIAS) {
                let possibleDirs = [...dirs].sort(() => Math.random() - 0.5);
                let foundDir = false;
                for (let d of possibleDirs) {
                    let tx = x + d[0];
                    let ty = y + d[1];
                    if (isValidZone(tx, ty)) {
                        const t = gameState.terrainMap[ty][tx];
                        if (t.id === 'plains' || t.id === 'street') {
                            currentDir = d;
                            nextX = tx;
                            nextY = ty;
                            foundDir = true;
                            break;
                        }
                    }
                }
                if (!foundDir) break;
            }
            x = nextX;
            y = nextY;
        }
    }

    // --- STREET ANTIALIASING ---
    // Make sure we carry height over
    for (let y = 0; y < GRID_SIZE - 1; y++) {
        for (let x = 0; x < GRID_SIZE - 1; x++) {
            const tl = gameState.terrainMap[y][x].id === 'street';
            const tr = gameState.terrainMap[y][x+1].id === 'street';
            const bl = gameState.terrainMap[y+1][x].id === 'street';
            const br = gameState.terrainMap[y+1][x+1].id === 'street';

            const fillStreet = (fx, fy) => {
                const currentHeight = gameState.terrainMap[fy][fx].height;
                gameState.terrainMap[fy][fx] = {
                    ...constants.TERRAIN.STREET,
                    height: currentHeight
                };
            }

            if (tl && br && !tr && !bl) {
                if (isValidZone(x + 1, y) && gameState.terrainMap[y][x+1].id === 'plains' && !causesBlob(x+1, y)) {
                    fillStreet(x+1, y);
                } else if (isValidZone(x, y + 1) && gameState.terrainMap[y+1][x].id === 'plains' && !causesBlob(x, y+1)) {
                    fillStreet(x, y+1);
                }
            }
            if (tr && bl && !tl && !br) {
                if (isValidZone(x, y) && gameState.terrainMap[y][x].id === 'plains' && !causesBlob(x, y)) {
                    fillStreet(x, y);
                } else if (isValidZone(x + 1, y + 1) && gameState.terrainMap[y+1][x+1].id === 'plains' && !causesBlob(x+1, y+1)) {
                    fillStreet(x+1, y+1);
                }
            }
        }
    }
}

module.exports = { generateMap };