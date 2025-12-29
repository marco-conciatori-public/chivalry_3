module.exports = {
    // Game Grid
    GRID_SIZE: 40,

    // Player Configuration
    PLAYER_COLORS: ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6'],
    STARTING_GOLD: 1200,

    // Combat Mechanics
    BONUS_FLANK: 10,
    BONUS_REAR: 20,
    BONUS_ANTI_CAVALRY: 30, // Bonus damage for Spearmen vs Cavalry
    BONUS_HIGH_GROUND_ATTACK: 10,
    BONUS_HIGH_GROUND_RANGE: 1,

    MIN_DAMAGE_REDUCTION_BY_HEALTH: 0.2,
    MAX_DAMAGE_REDUCTION_BY_DEFENSE: 0.1,
    DAMAGE_RANDOM_BASE: 0.8,
    DAMAGE_RANDOM_VARIANCE: 0.4,

    // Morale Mechanics
    MORALE_THRESHOLD: 30,
    MAX_MORALE: 100,
    COMMANDER_INFLUENCE_RANGE: 4,

    // Morale Events/Modifiers
    MORALE_PENALTY_WITNESS_DEATH: 10,
    MORALE_BONUS_WITNESS_ENEMY_DEATH: 10,
    MORALE_BONUS_ADJACENT_ALLY: 10,
    MORALE_PENALTY_SWARM_PER_UNIT: 10,
    MORALE_PENALTY_FLANK: 10,
    MORALE_PENALTY_REAR: 20,
    MORALE_BONUS_COMMANDER_SELF: 20,
    MORALE_BONUS_COMMANDER_AURA: 10,

    // Movement & Height Mechanics
    MAX_ELEVATION: 5,                // Maximum height for ground generation
    HEIGHT_DIFFERENCE_LIMIT: 1,      // Max height difference allowed for movement
    MOVEMENT_COST_HEIGHT_PENALTY: 1, // Extra cost per height level when moving UP

    // Map Generation Configuration
    MAP_GEN: {
        SPAWN_ZONE_HEIGHT: 2,      // Top/Bottom rows reserved for spawning
        BASE_AREA: 100,            // Reference area (10x10) for scaling calculations
        IMPASSABLE_THRESHOLD: 10,  // KEEPING FOR LEGACY/MAP GEN SAFETY (though logic is now height-based)

        // Note: Mountains config removed as specific terrain type is gone

        STREETS: {
            BASE_MIN: 2,
            BASE_VAR: 2,
            LENGTH_FACTOR: 0.8,    // Relative to GRID_SIZE
            TURN_BIAS: 0.2,        // Probability to turn
            DIRECTION_BIAS: 0.8    // Probability to continue in main direction
        },
        WALLS: {
            BASE_MIN: 1,
            BASE_VAR: 2,
            DENSITY: 0.25,
            LENGTH_MIN: 3,
            LENGTH_VAR: 6
        },
        FORESTS: {
            BASE_MIN: 2,
            BASE_VAR: 2,
            DENSITY: 0.7,
            BLOB_SIZE_MIN: 4,
            BLOB_SIZE_VAR: 8,
            MAX_HEIGHT: 3 // Max elevation (inclusive) where forests can grow
        },
        RIVERS: {
            DENSITY: 0.15,
            LENGTH_FACTOR: 1.5
        }
    },

    // TERRAIN DEFINITIONS
    // Height: Dynamic (0 to MAX_ELEVATION) for ground, -2 for Water, +2 relative for Walls
    TERRAIN: {
        PLAINS:   { id: 'plains',   symbol: '',   cost: 1,   height: 0,  defense: 0,  cover: 0,  blocksLos: false, color: '#a3d5a5' },
        FOREST:   { id: 'forest',   symbol: '🌲', cost: 2,   height: 0,  defense: 20, cover: 20, blocksLos: false, color: '#27ae60' }, // Color darkened slightly
        WALL:     { id: 'wall',     symbol: '🧱', cost: 1,   height: 2,  defense: 0,  cover: 0,  blocksLos: true,  color: '#7f8c8d' },
        WATER:    { id: 'water',    symbol: '🌊', cost: 1,   height: -2, defense: 0,  cover: 0,  blocksLos: false, color: '#85c1e9' },
        STREET:   { id: 'street',   symbol: '',   cost: 0.5, height: 0,  defense: 0,  cover: 0,  blocksLos: false, color: '#A8AFB5' }
    }
};