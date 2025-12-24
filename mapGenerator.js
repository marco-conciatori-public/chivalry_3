const constants = require('./constants');

function generateMap(gameState) {
    const CFG = constants.MAP_GEN; // Shortcut

    // 1. Reset to Plains
    for (let y = 0; y < constants.GRID_SIZE; y++) {
        for (let x = 0; x < constants.GRID_SIZE; x++) {
            gameState.terrainMap[y][x] = constants.TERRAIN.PLAINS;
        }
    }

    const isValidZone = (x, y) =>
        x >= 0 && x < constants.GRID_SIZE &&
        y >= CFG.SPAWN_ZONE_HEIGHT &&
        y < constants.GRID_SIZE - CFG.SPAWN_ZONE_HEIGHT;

    const areaScale = (constants.GRID_SIZE * constants.GRID_SIZE) / CFG.BASE_AREA;

    // 2. STREETS
    const numStreets = Math.floor(Math.random() * CFG.STREETS.BASE_VAR) + CFG.STREETS.BASE_MIN;
    const totalStreets = Math.floor(numStreets * Math.sqrt(areaScale));

    for(let i=0; i<totalStreets; i++) {
        let x = Math.floor(Math.random() * constants.GRID_SIZE);
        let y = Math.floor(Math.random() * constants.GRID_SIZE);

        let length = Math.floor(constants.GRID_SIZE * CFG.STREETS.LENGTH_FACTOR);
        let dir = Math.random() < 0.5 ? 0 : 1;

        for(let j=0; j<length; j++) {
            if(isValidZone(x, y)) {
                gameState.terrainMap[y][x] = constants.TERRAIN.STREET;
            }

            if (dir === 0) {
                x += (Math.random() < CFG.STREETS.DIRECTION_BIAS ? 1 : 0);
                y += (Math.random() < CFG.STREETS.TURN_BIAS ? (Math.random() < 0.5 ? 1 : -1) : 0);
            } else {
                y += (Math.random() < CFG.STREETS.DIRECTION_BIAS ? 1 : 0);
                x += (Math.random() < CFG.STREETS.TURN_BIAS ? (Math.random() < 0.5 ? 1 : -1) : 0);
            }

            x = Math.max(0, Math.min(constants.GRID_SIZE-1, x));
            y = Math.max(0, Math.min(constants.GRID_SIZE-1, y));
        }
    }

    // 3. MOUNTAINS
    const baseMountains = Math.floor(Math.random() * CFG.MOUNTAINS.BASE_VAR) + CFG.MOUNTAINS.BASE_MIN;
    const targetMountainGroups = Math.floor(baseMountains * areaScale * CFG.MOUNTAINS.DENSITY);

    let mountainAttempts = 0;
    let groupsPlaced = 0;

    while(groupsPlaced < targetMountainGroups && mountainAttempts < (CFG.MOUNTAINS.MAX_ATTEMPTS_SCALE * areaScale)) {
        mountainAttempts++;
        const size = Math.random() < 0.5 ? CFG.MOUNTAINS.GROUP_SIZE_SMALL : CFG.MOUNTAINS.GROUP_SIZE_LARGE;

        const mx = Math.floor(Math.random() * (constants.GRID_SIZE - size - 2)) + 1;
        const my = Math.floor(Math.random() * (constants.GRID_SIZE - size - (CFG.SPAWN_ZONE_HEIGHT * 2 + 2))) + (CFG.SPAWN_ZONE_HEIGHT + 1);

        let canPlace = true;
        // Check buffer zone
        for (let y = my - 1; y < my + size + 1; y++) {
            for (let x = mx - 1; x < mx + size + 1; x++) {
                if (y >= 0 && y < constants.GRID_SIZE && x >= 0 && x < constants.GRID_SIZE) {
                    if (gameState.terrainMap[y][x].id === 'mountain') {
                        canPlace = false;
                        break;
                    }
                }
            }
            if (!canPlace) break;
        }

        if (canPlace) {
            for (let y = my; y < my + size; y++) {
                for (let x = mx; x < mx + size; x++) {
                    if (isValidZone(x, y)) {
                        gameState.terrainMap[y][x] = constants.TERRAIN.MOUNTAIN;
                    }
                }
            }
            groupsPlaced++;
        }
    }

    // 4. WALLS
    const baseWalls = Math.floor(Math.random() * CFG.WALLS.BASE_VAR) + CFG.WALLS.BASE_MIN;
    const numWalls = Math.floor(baseWalls * areaScale * CFG.WALLS.DENSITY);

    for (let i = 0; i < numWalls; i++) {
        let startX = Math.floor(Math.random() * constants.GRID_SIZE);
        let startY = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;
        let isVertical = Math.random() < 0.5;
        let length = Math.floor(Math.random() * CFG.WALLS.LENGTH_VAR) + CFG.WALLS.LENGTH_MIN;

        for (let l = 0; l < length; l++) {
            let wx = isVertical ? startX : startX + l;
            let wy = isVertical ? startY + l : startY;

            if (isValidZone(wx, wy) && (gameState.terrainMap[wy][wx].id === 'plains' || gameState.terrainMap[wy][wx].id === 'street')) {
                gameState.terrainMap[wy][wx] = constants.TERRAIN.WALL;
            }
        }
    }

    // 5. FORESTS
    const baseForests = Math.floor(Math.random() * CFG.FORESTS.BASE_VAR) + CFG.FORESTS.BASE_MIN;
    const numForests = Math.floor(baseForests * areaScale * CFG.FORESTS.DENSITY);

    for (let i = 0; i < numForests; i++) {
        let cx = Math.floor(Math.random() * constants.GRID_SIZE);
        let cy = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;

        if (isValidZone(cx, cy)) {
            const blobSize = Math.floor(Math.random() * CFG.FORESTS.BLOB_SIZE_VAR) + CFG.FORESTS.BLOB_SIZE_MIN;
            let openSet = [{x: cx, y: cy}];
            let placedCount = 0;

            while(placedCount < blobSize && openSet.length > 0) {
                let idx = Math.floor(Math.random() * openSet.length);
                let current = openSet.splice(idx, 1)[0];

                if (isValidZone(current.x, current.y)) {
                    if (gameState.terrainMap[current.y][current.x].id === 'plains' || gameState.terrainMap[current.y][current.x].id === 'street') {
                        gameState.terrainMap[current.y][current.x] = constants.TERRAIN.FOREST;
                        placedCount++;
                        [{dx:0, dy:1}, {dx:0, dy:-1}, {dx:1, dy:0}, {dx:-1, dy:0}].forEach(({dx, dy}) => {
                            openSet.push({x: current.x + dx, y: current.y + dy});
                        });
                    }
                }
            }
        }
    }

    // 6. RIVERS
    const numRivers = Math.max(1, Math.floor(areaScale * CFG.RIVERS.DENSITY));
    for(let r=0; r<numRivers; r++) {
        let rx = Math.floor(Math.random() * constants.GRID_SIZE);
        let ry = Math.floor(Math.random() * (constants.GRID_SIZE - (CFG.SPAWN_ZONE_HEIGHT * 2))) + CFG.SPAWN_ZONE_HEIGHT;
        let riverLength = Math.floor(constants.GRID_SIZE * CFG.RIVERS.LENGTH_FACTOR);

        for(let i=0; i<riverLength; i++) {
            if (isValidZone(rx, ry)) {
                if (gameState.terrainMap[ry][rx].id !== 'mountain') {
                    gameState.terrainMap[ry][rx] = constants.TERRAIN.WATER;
                }
            }
            let move = Math.random();
            if (move < 0.5) rx += (Math.random() < 0.5 ? 1 : -1);
            else ry += (Math.random() < 0.5 ? 1 : -1);
        }
    }
}

module.exports = { generateMap };